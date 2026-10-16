import AppKit
import Foundation
let output = CommandLine.arguments[1]
let size = CGSize(width: 1024, height: 1024)
let image = NSImage(size: size)
image.lockFocus()
NSColor(calibratedRed: 0.92, green: 0.95, blue: 0.89, alpha: 1).setFill()
NSBezierPath(roundedRect: NSRect(x: 32, y: 32, width: 960, height: 960), xRadius: 218, yRadius: 218).fill()
NSColor(calibratedRed: 0.16, green: 0.40, blue: 0.30, alpha: 1).setFill()
NSBezierPath(roundedRect: NSRect(x: 132, y: 132, width: 760, height: 760), xRadius: 155, yRadius: 155).fill()
let heights: [CGFloat] = [116, 224, 365, 270, 468, 332, 180]
for (index, height) in heights.enumerated() {
  NSColor(calibratedRed: 0.85, green: 0.94, blue: 0.76, alpha: 1).setFill()
  NSBezierPath(roundedRect: NSRect(x: 260 + CGFloat(index) * 74, y: 512 - height / 2, width: 40, height: height), xRadius: 20, yRadius: 20).fill()
}
image.unlockFocus()
let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!)!
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: output))
