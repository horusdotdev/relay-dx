use std::collections::{BTreeMap, BTreeSet};

use graphql_syntax::{
    ConstantValue, Directive, ExecutableDefinition, OperationKind, Selection, Value,
};
use intern::string_key::Lookup;
use relay_compiler::{GraphQLAsts, ProjectName, config::Config, config::ProjectConfig};
use schema::{SDLSchema, Schema, Type};

pub type ConnectionKeys = BTreeMap<String, BTreeMap<String, BTreeSet<String>>>;
pub type SelectedFields = BTreeMap<String, BTreeMap<String, bool>>;

#[derive(Default)]
pub struct DocumentMetadata {
    pub connections: ConnectionKeys,
    pub selections: SelectedFields,
}

/// Read Relay's parsed source graph, without generating or executing artifacts.
pub fn collect(
    schema: &SDLSchema,
    config: &Config,
    project: &ProjectConfig,
    asts: &fnv::FnvHashMap<ProjectName, GraphQLAsts>,
) -> Result<DocumentMetadata, String> {
    let mut keys = DocumentMetadata::default();
    let mut seen = BTreeSet::new();
    let mut name = Some(project.name);
    while let Some(project_name) = name {
        if !seen.insert(project_name.to_string()) {
            break;
        }
        if let Some(project_asts) = asts.get(&project_name) {
            for definition in project_asts.get_all_executable_definitions() {
                let (parent, selections) = match definition {
                    ExecutableDefinition::Operation(operation) => (
                        match operation.operation_kind() {
                            OperationKind::Query => schema.query_type(),
                            OperationKind::Mutation => schema.mutation_type(),
                            OperationKind::Subscription => schema.subscription_type(),
                        },
                        &operation.selections.items,
                    ),
                    ExecutableDefinition::Fragment(fragment) => (
                        schema.get_type(fragment.type_condition.type_.value),
                        &fragment.selections.items,
                    ),
                };
                if let Some(parent) = parent {
                    visit(schema, parent, selections, &mut keys)?;
                }
            }
        }
        name = config.projects.get(&project_name).and_then(|p| p.base);
    }
    Ok(keys)
}

fn visit(
    schema: &SDLSchema,
    parent: Type,
    selections: &[Selection],
    keys: &mut DocumentMetadata,
) -> Result<(), String> {
    for selection in selections {
        match selection {
            Selection::LinkedField(field) => {
                let Some(id) = schema.named_field(parent, field.name.value) else {
                    // Schema extraction also supports projects with unfinished operations.
                    continue;
                };
                selected(
                    keys,
                    schema,
                    parent,
                    field.name.value.lookup(),
                    &field.directives,
                );
                for directive in &field.directives {
                    if !matches!(
                        directive.name.value.lookup(),
                        "connection" | "stream_connection"
                    ) {
                        continue;
                    }
                    let key = directive
                        .arguments
                        .as_ref()
                        .and_then(|arguments| {
                            arguments.items.iter().find_map(|argument| {
                                if argument.name.value.lookup() != "key" {
                                    return None;
                                }
                                match &argument.value {
                                    Value::Constant(ConstantValue::String(value)) => {
                                        Some(value.value)
                                    }
                                    _ => None,
                                }
                            })
                        })
                        .ok_or_else(|| {
                            format!(
                                "{}.{} @{} requires a constant string key.",
                                schema.get_type_name(parent),
                                field.name.value,
                                directive.name.value
                            )
                        })?;
                    keys.connections
                        .entry(schema.get_type_name(parent).lookup().to_owned())
                        .or_default()
                        .entry(field.name.value.lookup().to_owned())
                        .or_default()
                        .insert(key.lookup().to_owned());
                }
                visit(
                    schema,
                    schema.field(id).type_.inner(),
                    &field.selections.items,
                    keys,
                )?;
            }
            Selection::InlineFragment(fragment) => {
                let parent = fragment
                    .type_condition
                    .as_ref()
                    .map_or(Some(parent), |condition| {
                        schema.get_type(condition.type_.value)
                    });
                if let Some(parent) = parent {
                    visit(schema, parent, &fragment.selections.items, keys)?;
                }
            }
            // Each fragment definition is visited once in its own type context.
            Selection::ScalarField(field) => {
                if schema.named_field(parent, field.name.value).is_some() {
                    selected(
                        keys,
                        schema,
                        parent,
                        field.name.value.lookup(),
                        &field.directives,
                    );
                }
            }
            Selection::FragmentSpread(_) => {}
        }
    }
    Ok(())
}

fn selected(
    metadata: &mut DocumentMetadata,
    schema: &SDLSchema,
    parent: Type,
    name: &str,
    directives: &[Directive],
) {
    let required = directives
        .iter()
        .any(|directive| directive.name.value.lookup() == "required");
    metadata
        .selections
        .entry(schema.get_type_name(parent).lookup().to_owned())
        .or_default()
        .entry(name.to_owned())
        .and_modify(|value| *value |= required)
        .or_insert(required);
}
