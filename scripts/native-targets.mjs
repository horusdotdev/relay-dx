export const NATIVE_TARGETS = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "win32-x64",
];

export function executableName(target) {
  return target.startsWith("win32-") ? "relay-schema-native.exe" : "relay-schema-native";
}

export function validateNativeBinary(target, binary) {
  if (binary.length < 1024) throw new Error(`Native artifact is too small: ${target}`);
  if (target.startsWith("linux-")) {
    const machine = target.endsWith("arm64") ? 183 : 62;
    if (binary.subarray(0, 4).toString("hex") !== "7f454c46" || binary.readUInt16LE(18) !== machine)
      throw new Error(`Expected an ELF binary for ${target}`);
  } else if (target.startsWith("darwin-")) {
    const cpu = target.endsWith("arm64") ? 0x0100000c : 0x01000007;
    if (binary.readUInt32LE(0) !== 0xfeedfacf || binary.readUInt32LE(4) !== cpu)
      throw new Error(`Expected a Mach-O binary for ${target}`);
  } else {
    const peOffset = binary.readUInt32LE(0x3c);
    if (
      binary.subarray(0, 2).toString() !== "MZ" ||
      peOffset + 6 > binary.length ||
      binary.readUInt32LE(peOffset) !== 0x00004550 ||
      binary.readUInt16LE(peOffset + 4) !== 0x8664
    )
      throw new Error(`Expected a Windows x64 PE binary`);
  }
}
