// Asks macOS itself which apps it would offer for each kind of file. Run by CI after the app has
// been registered: swift scripts/mac-check-file-types.swift /path/to/full.app
import AppKit

let args = CommandLine.arguments
guard args.count == 2 else {
    print("Usage: mac-check-file-types.swift <app>")
    exit(2)
}
let appId = Bundle(path: args[1])!.bundleIdentifier!
let folder = FileManager.default.temporaryDirectory.appendingPathComponent("full-file-types-\(getpid())")
try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)

func handlers(_ ext: String) -> (offered: Bool, isDefault: Bool, defaultApp: String) {
    let file = folder.appendingPathComponent("sample.\(ext)")
    FileManager.default.createFile(atPath: file.path, contents: Data("a,b\n".utf8))
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
    print(".\(ext): offered \(result.offered), default app \(result.defaultApp)")
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
