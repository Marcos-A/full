// Asks macOS itself which apps it would offer for each kind of file. Run by CI after the app has
// been registered: swift scripts/mac-check-file-types.swift /path/to/full.app
import AppKit
import UniformTypeIdentifiers

let args = CommandLine.arguments
guard args.count == 2 else {
    print("Usage: mac-check-file-types.swift <app>")
    exit(2)
}
let appId = Bundle(path: args[1])!.bundleIdentifier!
let folder = FileManager.default.temporaryDirectory.appendingPathComponent("full-file-types-\(getpid())")
try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)

func sample(_ ext: String) -> URL {
    let file = folder.appendingPathComponent("sample.\(ext)")
    FileManager.default.createFile(atPath: file.path, contents: Data("a,b\n".utf8))
    return file
}

/// The type macOS gives a file with this extension, and whether it counts as text, which is what
/// full's "Other text document" entry claims. When full isn't offered, this says why.
func typeOf(_ ext: String) -> String {
    guard let type = try? sample(ext).resourceValues(forKeys: [.contentTypeKey]).contentType else { return "no type" }
    return "\(type.identifier)\(type.isDynamic ? " (dynamic)" : ""), text: \(type.conforms(to: .text)), declared: \(type.isDeclared)"
}

/// The registry entries that declare this type, so a failure names the app that changed it.
func declarers(of identifier: String) -> [String] {
    let tool = Process()
    tool.executableURL = URL(fileURLWithPath: "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister")
    tool.arguments = ["-dump"]
    let pipe = Pipe()
    tool.standardOutput = pipe
    guard (try? tool.run()) != nil else { return [] }
    let dump = String(decoding: pipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
    tool.waitUntilExit()
    return dump.components(separatedBy: "\n-------")
        .filter { $0.contains("type id:") && $0.contains(identifier) }
        .prefix(5)
        .map { block in
            block.split(separator: "\n")
                .filter { line in ["type id:", "bundle:", "conforms to:", "tags:", "flags:"].contains { line.contains($0) } }
                .joined(separator: "\n")
        }
}

func handlers(_ ext: String) -> (offered: Bool, isDefault: Bool, defaultApp: String) {
    let file = sample(ext)
    let isFull = { (url: URL) in Bundle(url: url)?.bundleIdentifier == appId }
    let offered = NSWorkspace.shared.urlsForApplications(toOpen: file).contains(where: isFull)
    let defaultUrl = NSWorkspace.shared.urlForApplication(toOpen: file)
    return (offered, defaultUrl.map(isFull) ?? false, defaultUrl?.lastPathComponent ?? "none")
}

var failed = false
func expect(_ condition: Bool, _ message: String) {
    if !condition {
        print("::error::\(message)")
        failed = true
    }
}

for ext in ["md", "markdown", "csv", "txt", "py", "c", "swift", "json", "xml", "html", "log", "tsv"] {
    let result = handlers(ext)
    print(".\(ext): offered \(result.offered), default app \(result.defaultApp), type \(typeOf(ext))")
    if !result.offered, let type = try? sample(ext).resourceValues(forKeys: [.contentTypeKey]).contentType {
        for entry in declarers(of: type.identifier) { print("  declared by:\n\(entry)") }
    }
    expect(result.offered, ".\(ext) should offer full under Open With")
}
for ext in ["txt", "py", "html"] {
    expect(!handlers(ext).isDefault, ".\(ext) must not default to full")
}

for ext in ["png", "jpg", "pdf", "zip"] {
    let result = handlers(ext)
    print(".\(ext): offered \(result.offered)")
    expect(!result.offered, ".\(ext) isn't text, so Finder shouldn't offer full for it")
}
exit(failed ? 1 : 0)
