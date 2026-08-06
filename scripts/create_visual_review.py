from argparse import ArgumentParser
from pathlib import Path

from PIL import Image, ImageChops


def create_visual_review(
    reference_path: Path, implementation_path: Path, output_prefix: Path
) -> None:
    with Image.open(reference_path) as reference_source, Image.open(
        implementation_path
    ) as implementation_source:
        if reference_source.size != implementation_source.size:
            raise ValueError(
                "reference and implementation must have the same dimensions: "
                f"{reference_source.size} != {implementation_source.size}"
            )

        reference = reference_source.convert("RGB")
        implementation = implementation_source.convert("RGB")
        width, height = reference.size
        side_by_side = Image.new("RGB", (width * 2, height))
        side_by_side.paste(reference, (0, 0))
        side_by_side.paste(implementation, (width, 0))
        overlay = Image.blend(reference, implementation, 0.5)
        difference = ImageChops.difference(reference, implementation)

        output_prefix.parent.mkdir(parents=True, exist_ok=True)
        side_by_side.save(f"{output_prefix}-side-by-side.png")
        overlay.save(f"{output_prefix}-overlay-50.png")
        difference.save(f"{output_prefix}-difference.png")


def main() -> None:
    parser = ArgumentParser(description="Create same-size visual review evidence.")
    parser.add_argument("reference", type=Path)
    parser.add_argument("implementation", type=Path)
    parser.add_argument("output_prefix", type=Path)
    arguments = parser.parse_args()
    create_visual_review(
        arguments.reference, arguments.implementation, arguments.output_prefix
    )


if __name__ == "__main__":
    main()
