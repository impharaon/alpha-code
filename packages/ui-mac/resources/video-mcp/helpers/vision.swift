import Foundation
import Vision
import ImageIO

struct Line: Codable { let text: String; let box: [Double] }
struct Output: Codable { let text: String; let lines: [Line] }

do {
    guard CommandLine.arguments.count == 2 else { throw NSError(domain: "video-ocr", code: 1) }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]
    request.usesLanguageCorrection = false
    if #available(macOS 13.0, *) { request.automaticallyDetectsLanguage = true }
    try VNImageRequestHandler(url: URL(fileURLWithPath: CommandLine.arguments[1]), options: [:]).perform([request])
    let lines = (request.results ?? []).compactMap { observation -> Line? in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        let box = observation.boundingBox
        return Line(text: candidate.string, box: [box.minX, 1 - box.maxY, box.width, box.height])
    }
    let output = Output(text: lines.map(\.text).joined(separator: "\n"), lines: lines)
    FileHandle.standardOutput.write(try JSONEncoder().encode(output))
} catch {
    FileHandle.standardError.write(Data("Local OCR failed.\n".utf8))
    exit(1)
}
