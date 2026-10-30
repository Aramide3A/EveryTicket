import Foundation
import AVFoundation
import AppKit

let input = URL(fileURLWithPath: "/Users/al-ameen/Documents/EveryTicket/EveryTicetui-ux interface.mp4")
let output = URL(fileURLWithPath: "/Users/al-ameen/Documents/EveryTicket/tmp/video-frames", isDirectory: true)
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)

let asset = AVURLAsset(url: input)
let duration = try await asset.load(.duration)
let seconds = CMTimeGetSeconds(duration)
let generator = AVAssetImageGenerator(asset: asset)
generator.appliesPreferredTrackTransform = true
generator.maximumSize = CGSize(width: 1600, height: 1000)

let count = 12
for index in 0..<count {
    let position = seconds * Double(index) / Double(max(count - 1, 1))
    let time = CMTime(seconds: position, preferredTimescale: 600)
    let image = try generator.copyCGImage(at: time, actualTime: nil)
    let bitmap = NSBitmapImageRep(cgImage: image)
    guard let data = bitmap.representation(using: .png, properties: [:]) else { continue }
    let name = String(format: "frame-%02d-%.1fs.png", index + 1, position)
    try data.write(to: output.appendingPathComponent(name))
}

print(String(format: "duration=%.2f frames=%d", seconds, count))
