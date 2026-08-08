import AppKit

struct MarkerSpec {
  let name: String
  let width: Int
  let height: Int
}

let markers = [
  MarkerSpec(name: "map-marker-online", width: 64, height: 80),
  MarkerSpec(name: "map-marker-online-selected", width: 72, height: 88),
  MarkerSpec(name: "map-marker-directory", width: 64, height: 80),
  MarkerSpec(name: "map-marker-directory-selected", width: 72, height: 88),
]
let repository = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
let sourceDirectory = repository.appendingPathComponent("artifacts/ui/sources/map-markers", isDirectory: true)
let outputDirectory = repository.appendingPathComponent("miniprogram/assets", isDirectory: true)

for marker in markers {
  let source = sourceDirectory.appendingPathComponent("\(marker.name).svg")
  let destination = outputDirectory.appendingPathComponent("\(marker.name).png")
  guard let image = NSImage(contentsOf: source),
        let bitmap = NSBitmapImageRep(
          bitmapDataPlanes: nil,
          pixelsWide: marker.width,
          pixelsHigh: marker.height,
          bitsPerSample: 8,
          samplesPerPixel: 4,
          hasAlpha: true,
          isPlanar: false,
          colorSpaceName: .deviceRGB,
          bytesPerRow: 0,
          bitsPerPixel: 0
        ),
        let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
    fatalError("Could not render \(source.path)")
  }

  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = context
  context.imageInterpolation = .high
  context.cgContext.clear(CGRect(x: 0, y: 0, width: marker.width, height: marker.height))
  image.draw(
    in: CGRect(x: 0, y: 0, width: marker.width, height: marker.height),
    from: .zero,
    operation: .sourceOver,
    fraction: 1
  )
  NSGraphicsContext.restoreGraphicsState()

  guard let png = bitmap.representation(using: .png, properties: [:]) else {
    fatalError("Could not encode \(destination.path)")
  }
  try png.write(to: destination, options: .atomic)
}
