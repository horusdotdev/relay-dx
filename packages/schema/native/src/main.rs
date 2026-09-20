use std::collections::BTreeMap;
use std::env;
use std::path::PathBuf;
use std::sync::Arc;

use common::{NoopPerfLogger, PerfLogger};
use graphql_syntax::{SchemaDocument, StringNode, TypeSystemDefinition};
use intern::string_key::{Intern, Lookup};
use relay_compiler::GraphQLAsts;
use relay_compiler::NoopArtifactWriter;
use relay_compiler::build_schema;
use relay_compiler::compiler_state::CompilerState;
use relay_compiler::config::FileSourceKind;
use relay_compiler::config::ProjectConfig;
use relay_compiler::file_source::FileSource;
use relay_docblock::ParseOptions;
use schema::{ArgumentDefinitions, SDLSchema, Schema};
use schema_print::print;
use serde::Serialize;

#[derive(Debug)]
struct Args {
    config: PathBuf,
    project: Option<String>,
}

#[derive(Serialize)]
struct Output {
    project_name: String,
    config_path: String,
    root_directory: String,
    sdl: String,
    descriptions: BTreeMap<String, String>,
    compiler_version: &'static str,
}

fn add_description(
    descriptions: &mut BTreeMap<String, String>,
    coordinate: String,
    description: Option<intern::string_key::StringKey>,
) {
    if let Some(description) = description {
        descriptions.insert(coordinate, description.lookup().to_string());
    }
}

fn add_arguments(
    descriptions: &mut BTreeMap<String, String>,
    parent: &str,
    arguments: &ArgumentDefinitions,
) {
    for argument in arguments.iter() {
        add_description(
            descriptions,
            format!("{parent}({}:)", argument.name.item.0.lookup()),
            argument.description,
        );
    }
}

fn add_input_fields(
    descriptions: &mut BTreeMap<String, String>,
    parent: &str,
    arguments: &ArgumentDefinitions,
) {
    for argument in arguments.iter() {
        add_description(
            descriptions,
            format!("{parent}.{}", argument.name.item.0.lookup()),
            argument.description,
        );
    }
}

fn add_field_descriptions(
    descriptions: &mut BTreeMap<String, String>,
    schema: &SDLSchema,
    parent: &str,
    fields: impl IntoIterator<Item = schema::FieldID>,
) {
    for field_id in fields {
        let field = schema.field(field_id);
        let field_coordinate = format!("{parent}.{}", field.name.item.lookup());
        add_description(descriptions, field_coordinate.clone(), field.description);
        add_arguments(descriptions, &field_coordinate, &field.arguments);
    }
}

fn collect_descriptions(schema: &SDLSchema) -> BTreeMap<String, String> {
    let mut descriptions = BTreeMap::new();

    for object in schema.objects() {
        let name = object.name.item.0.lookup();
        add_description(&mut descriptions, name.to_string(), object.description);
        add_field_descriptions(
            &mut descriptions,
            schema,
            name,
            object.fields.iter().copied(),
        );
    }
    for interface in schema.interfaces() {
        let name = interface.name.item.0.lookup();
        add_description(&mut descriptions, name.to_string(), interface.description);
        add_field_descriptions(
            &mut descriptions,
            schema,
            name,
            interface.fields.iter().copied(),
        );
    }
    for input_object in schema.input_objects() {
        let name = input_object.name.item.0.lookup();
        add_description(
            &mut descriptions,
            name.to_string(),
            input_object.description,
        );
        add_input_fields(&mut descriptions, name, &input_object.fields);
    }
    for enum_ in schema.enums() {
        let name = enum_.name.item.0.lookup();
        add_description(&mut descriptions, name.to_string(), enum_.description);
        for value in &enum_.values {
            add_description(
                &mut descriptions,
                format!("{name}.{}", value.value.lookup()),
                value.description,
            );
        }
    }
    for scalar in schema.scalars() {
        add_description(
            &mut descriptions,
            scalar.name.item.0.lookup().to_string(),
            scalar.description,
        );
    }
    for union in schema.unions() {
        add_description(
            &mut descriptions,
            union.name.item.0.lookup().to_string(),
            union.description,
        );
    }
    for directive in schema.get_directives() {
        let name = directive.name.item.0.lookup();
        add_description(&mut descriptions, format!("@{name}"), directive.description);
        add_arguments(&mut descriptions, &format!("@{name}"), &directive.arguments);
    }

    descriptions
}

fn source_description(node: &StringNode, source: Option<&str>) -> String {
    let value = node.value.lookup();
    let Some(source) = source else {
        return value.to_string();
    };
    let (start, end) = node.token.span.as_usize();
    let Some(raw) = source.get(start..end) else {
        return value.to_string();
    };
    if raw.starts_with("\"\"") {
        // graphql-syntax applies block-string indentation cleanup but v21.0.1
        // leaves escaped triple quotes untouched.
        return value.replace("\\\"\"\"", "\"\"\"");
    }
    let json_compatible = raw.replace('\t', "\\t");
    serde_json::from_str::<String>(&json_compatible).unwrap_or_else(|_| value.to_string())
}

fn add_ast_arguments(
    descriptions: &mut BTreeMap<String, String>,
    parent: &str,
    arguments: Option<&graphql_syntax::List<graphql_syntax::InputValueDefinition>>,
    source: Option<&str>,
) {
    if let Some(arguments) = arguments {
        for argument in &arguments.items {
            if let Some(description) = &argument.description {
                descriptions.insert(
                    format!("{parent}({}:)", argument.name.value.lookup()),
                    source_description(description, source),
                );
            }
        }
    }
}

fn add_ast_fields(
    descriptions: &mut BTreeMap<String, String>,
    parent: &str,
    fields: Option<&graphql_syntax::List<graphql_syntax::FieldDefinition>>,
    source: Option<&str>,
) {
    if let Some(fields) = fields {
        for field in &fields.items {
            let field_coordinate = format!("{parent}.{}", field.name.value.lookup());
            if let Some(description) = &field.description {
                descriptions.insert(
                    field_coordinate.clone(),
                    source_description(description, source),
                );
            }
            add_ast_arguments(
                descriptions,
                &field_coordinate,
                field.arguments.as_ref(),
                source,
            );
        }
    }
}

fn add_ast_definition(
    descriptions: &mut BTreeMap<String, String>,
    definition: &TypeSystemDefinition,
    source: Option<&str>,
) {
    match definition {
        TypeSystemDefinition::SchemaDefinition(definition) => {
            if let Some(description) = &definition.description {
                descriptions.insert(
                    "$schema".to_string(),
                    source_description(description, source),
                );
            }
        }
        TypeSystemDefinition::ObjectTypeDefinition(definition) => {
            let name = definition.name.value.lookup();
            if let Some(description) = &definition.description {
                descriptions.insert(name.to_string(), source_description(description, source));
            }
            add_ast_fields(descriptions, name, definition.fields.as_ref(), source);
        }
        TypeSystemDefinition::InterfaceTypeDefinition(definition) => {
            let name = definition.name.value.lookup();
            if let Some(description) = &definition.description {
                descriptions.insert(name.to_string(), source_description(description, source));
            }
            add_ast_fields(descriptions, name, definition.fields.as_ref(), source);
        }
        TypeSystemDefinition::UnionTypeDefinition(definition) => {
            if let Some(description) = &definition.description {
                descriptions.insert(
                    definition.name.value.lookup().to_string(),
                    source_description(description, source),
                );
            }
        }
        TypeSystemDefinition::ScalarTypeDefinition(definition) => {
            if let Some(description) = &definition.description {
                descriptions.insert(
                    definition.name.value.lookup().to_string(),
                    source_description(description, source),
                );
            }
        }
        TypeSystemDefinition::EnumTypeDefinition(definition) => {
            let name = definition.name.value.lookup();
            if let Some(description) = &definition.description {
                descriptions.insert(name.to_string(), source_description(description, source));
            }
            if let Some(values) = &definition.values {
                for value in &values.items {
                    if let Some(description) = &value.description {
                        descriptions.insert(
                            format!("{name}.{}", value.name.value.lookup()),
                            source_description(description, source),
                        );
                    }
                }
            }
        }
        TypeSystemDefinition::InputObjectTypeDefinition(definition) => {
            let name = definition.name.value.lookup();
            if let Some(description) = &definition.description {
                descriptions.insert(name.to_string(), source_description(description, source));
            }
            if let Some(fields) = &definition.fields {
                for field in &fields.items {
                    if let Some(description) = &field.description {
                        descriptions.insert(
                            format!("{name}.{}", field.name.value.lookup()),
                            source_description(description, source),
                        );
                    }
                }
            }
        }
        TypeSystemDefinition::DirectiveDefinition(definition) => {
            let name = format!("@{}", definition.name.value.lookup());
            if let Some(description) = &definition.description {
                descriptions.insert(name.clone(), source_description(description, source));
            }
            add_ast_arguments(descriptions, &name, definition.arguments.as_ref(), source);
        }
        TypeSystemDefinition::ObjectTypeExtension(definition) => {
            add_ast_fields(
                descriptions,
                definition.name.value.lookup(),
                definition.fields.as_ref(),
                source,
            );
        }
        TypeSystemDefinition::InterfaceTypeExtension(definition) => {
            add_ast_fields(
                descriptions,
                definition.name.value.lookup(),
                definition.fields.as_ref(),
                source,
            );
        }
        TypeSystemDefinition::InputObjectTypeExtension(definition) => {
            let name = definition.name.value.lookup();
            if let Some(fields) = &definition.fields {
                for field in &fields.items {
                    if let Some(description) = &field.description {
                        descriptions.insert(
                            format!("{name}.{}", field.name.value.lookup()),
                            source_description(description, source),
                        );
                    }
                }
            }
        }
        TypeSystemDefinition::EnumTypeExtension(definition) => {
            let name = definition.name.value.lookup();
            if let Some(values) = &definition.values {
                for value in &values.items {
                    if let Some(description) = &value.description {
                        descriptions.insert(
                            format!("{name}.{}", value.name.value.lookup()),
                            source_description(description, source),
                        );
                    }
                }
            }
        }
        TypeSystemDefinition::UnionTypeExtension(_)
        | TypeSystemDefinition::ScalarTypeExtension(_) => {}
        TypeSystemDefinition::SchemaExtension(_) => {}
    }
}

fn add_schema_documents(
    descriptions: &mut BTreeMap<String, String>,
    documents: impl IntoIterator<Item = (String, SchemaDocument)>,
) {
    for (source, document) in documents {
        for definition in &document.definitions {
            add_ast_definition(descriptions, definition, Some(&source));
        }
    }
}

fn collect_schema_source_descriptions(
    descriptions: &mut BTreeMap<String, String>,
    state: &CompilerState,
    project: &ProjectConfig,
) -> Result<(), String> {
    let mut documents = Vec::new();
    if let Some(sources) = state.schemas.get(&project.name) {
        for (source, location) in sources.get_sources_with_location() {
            let document = graphql_syntax::parse_schema_document(source, location)
                .map_err(|error| format!("Relay schema description parsing failed: {error:?}"))?;
            documents.push((source.clone(), document));
        }
    }
    if let Some(sources) = state.extensions.get(&project.name) {
        for (source, location) in sources.get_sources_with_location() {
            let document =
                graphql_syntax::parse_schema_document(source, location).map_err(|error| {
                    format!("Relay schema extension description parsing failed: {error:?}")
                })?;
            documents.push((source.clone(), document));
        }
    }
    if let Some(base_name) = project.base
        && let Some(sources) = state.extensions.get(&base_name)
    {
        for (source, location) in sources.get_sources_with_location() {
            let document =
                graphql_syntax::parse_schema_document(source, location).map_err(|error| {
                    format!("Relay base schema extension description parsing failed: {error:?}")
                })?;
            documents.push((source.clone(), document));
        }
    }
    add_schema_documents(descriptions, documents);
    Ok(())
}

fn collect_resolver_descriptions(
    descriptions: &mut BTreeMap<String, String>,
    state: &CompilerState,
    config: &relay_compiler::config::Config,
    project: &ProjectConfig,
    graphql_asts: &fnv::FnvHashMap<relay_compiler::ProjectName, GraphQLAsts>,
    schema: &SDLSchema,
) -> Result<(), String> {
    let mut project_names = vec![project.name];
    if let Some(base) = project.base {
        project_names.push(base);
    }
    for project_name in project_names {
        let Some(docblocks) = state.docblocks.get(&project_name) else {
            continue;
        };
        let Some(project_asts) = graphql_asts.get(&project_name) else {
            continue;
        };
        let project_config = &config.projects[&project_name];
        let parse_options = ParseOptions {
            enable_interface_output_type: &project_config
                .feature_flags
                .relay_resolver_enable_interface_output_type,
            allow_resolver_non_nullable_return_type: &project_config
                .feature_flags
                .allow_resolver_non_nullable_return_type,
            allow_legacy_relay_resolver_tag: &project_config
                .feature_flags
                .allow_legacy_relay_resolver_tag,
        };
        for (file_path, sources) in docblocks.get_all() {
            let definitions = project_asts.get_executable_definitions_for_file(file_path);
            for located in sources {
                let source_location = common::SourceLocationKey::embedded(
                    &file_path.to_string_lossy(),
                    located.index,
                );
                let ast = docblock_syntax::parse_docblock(
                    &located.docblock_source.text_source().text,
                    source_location,
                )
                .map_err(|error| format!("Relay resolver docblock parsing failed: {error:?}"))?;
                let Some(ir) = relay_docblock::parse_docblock_ast(
                    &project_name,
                    &ast,
                    definitions,
                    &parse_options,
                )
                .map_err(|error| format!("Relay resolver description parsing failed: {error:?}"))?
                else {
                    continue;
                };
                let document = ir
                    .to_graphql_schema_ast(project_name, schema, &project_config.schema_config)
                    .map_err(|error| {
                        format!("Relay resolver schema generation failed: {error:?}")
                    })?;
                for definition in &document.definitions {
                    add_ast_definition(descriptions, definition, None);
                }
            }
        }
    }
    Ok(())
}

fn args() -> Result<Args, String> {
    let mut config = None;
    let mut project = None;
    let mut values = env::args().skip(1);
    while let Some(value) = values.next() {
        match value.as_str() {
            "--config" | "-c" => config = values.next().map(PathBuf::from),
            "--project" | "-p" => project = values.next(),
            "--help" | "-h" => {
                return Err(
                    "Usage: relay-schema-native --config <relay.config.json> [--project <name>]"
                        .to_string(),
                );
            }
            unknown => return Err(format!("Unknown argument {unknown}")),
        }
    }
    let config = config.ok_or_else(|| "Missing required --config path".to_string())?;
    Ok(Args { config, project })
}

fn run(args: Args) -> Result<Output, String> {
    let config_path = std::fs::canonicalize(&args.config)
        .map_err(|error| format!("Cannot resolve config {}: {error}", args.config.display()))?;
    if let Some(config_directory) = config_path.parent() {
        env::set_current_dir(config_directory).map_err(|error| {
            format!(
                "Cannot enter Relay config directory {}: {error}",
                config_directory.display()
            )
        })?;
    }
    let mut config =
        if config_path.file_name().and_then(|name| name.to_str()) == Some("package.json") {
            relay_compiler::config::Config::search(
                config_path
                    .parent()
                    .unwrap_or_else(|| std::path::Path::new(".")),
            )
        } else {
            relay_compiler::config::Config::load(config_path.clone())
        }
        .map_err(|error| format!("Relay compiler configuration failed: {error:?}"))?;
    // WalkDir is deterministic and does not require Watchman. NoopArtifactWriter
    // ensures compiling the source graph cannot write generated artifacts.
    config.file_source_config = FileSourceKind::WalkDir;
    config.artifact_writer = Box::new(NoopArtifactWriter);
    config.create_operation_persister = None;
    config.load_saved_state_file = None;
    let config = Arc::new(config);
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|error| format!("Could not start Relay compiler runtime: {error}"))?;
    let name = args
        .project
        .or_else(|| {
            (config.projects.len() == 1).then(|| config.projects.keys().next().unwrap().to_string())
        })
        .ok_or_else(|| {
            format!(
                "This config has multiple Relay projects; pass --project. Available projects: {:?}",
                config
                    .projects
                    .keys()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
            )
        })?;
    let project_name: relay_compiler::ProjectName = name.as_str().intern().into();
    let (schema, root_directory, state, graphql_asts) = runtime.block_on(async {
        let perf_logger = NoopPerfLogger;
        let setup_event = perf_logger.create_event("relay_schema_extraction");
        let file_source = FileSource::connect(&config, &setup_event)
            .await
            .map_err(|error| format!("Relay source discovery failed: {error:?}"))?;
        let state = file_source
            .query(&setup_event, &perf_logger)
            .await
            .map_err(|error| format!("Relay source loading failed: {error:?}"))?;
        let dirty = fnv::FnvHashMap::default();
        let graphql_asts =
            GraphQLAsts::from_graphql_sources_map(&state.graphql_sources, &dirty, &config)
                .map_err(|error| format!("Relay source parsing failed: {error:?}"))?;
        let project = config.projects.get(&project_name).ok_or_else(|| {
            format!(
                "Relay project {name:?} was not found. Available projects: {:?}",
                config
                    .projects
                    .keys()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
            )
        })?;
        let schema = build_schema(&state, &config, project, &graphql_asts, &setup_event)
            .map_err(|error| format!("Relay effective schema construction failed: {error:?}"))?;
        Ok::<_, String>((
            schema,
            config.root_dir.display().to_string(),
            state,
            graphql_asts,
        ))
    })?;
    let project = config.projects.get(&project_name).ok_or_else(|| {
        format!(
            "Relay project {name:?} was not found. Available projects: {:?}",
            config
                .projects
                .keys()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        )
    })?;
    let mut descriptions = BTreeMap::new();
    // Compact schemas contain the already-normalized server and extension schema;
    // their source text is intentionally unavailable, so only resolver metadata
    // and descriptions retained in the compact SDLSchema can be recovered.
    if !matches!(
        project.schema_location,
        relay_compiler::SchemaLocation::CompactFile(_)
    ) {
        collect_schema_source_descriptions(&mut descriptions, &state, project)?;
    }
    collect_resolver_descriptions(
        &mut descriptions,
        &state,
        &config,
        project,
        &graphql_asts,
        &schema,
    )?;
    for (coordinate, description) in collect_descriptions(&schema).into_iter() {
        descriptions.entry(coordinate).or_insert(description);
    }
    Ok(Output {
        project_name: name,
        config_path: config_path.display().to_string(),
        root_directory,
        sdl: print(&schema),
        descriptions,
        compiler_version: "21.0.1",
    })
}

fn main() {
    match args().and_then(run) {
        Ok(output) => match serde_json::to_string(&output) {
            Ok(serialized) => println!("{serialized}"),
            Err(error) => {
                eprintln!("Failed to serialize native schema result: {error}");
                std::process::exit(1);
            }
        },
        Err(error) => {
            eprintln!("relay-schema-native: {error}");
            std::process::exit(1);
        }
    }
}
