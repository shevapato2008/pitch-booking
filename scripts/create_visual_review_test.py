from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from PIL import Image

from scripts.create_visual_review import create_visual_review


class CreateVisualReviewTest(unittest.TestCase):
    def assert_image_size(self, path: Path, expected: tuple[int, int]) -> None:
        with Image.open(path) as image:
            self.assertEqual(image.size, expected)

    def test_writes_expected_comparison_images(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            reference = root / "reference.png"
            implementation = root / "implementation.png"
            prefix = root / "review"
            Image.new("RGB", (10, 10), (255, 0, 0)).save(reference)
            Image.new("RGB", (10, 10), (0, 0, 255)).save(implementation)

            create_visual_review(reference, implementation, prefix)

            self.assert_image_size(root / "review-side-by-side.png", (20, 10))
            self.assert_image_size(root / "review-overlay-50.png", (10, 10))
            self.assert_image_size(root / "review-difference.png", (10, 10))

    def test_rejects_mismatched_dimensions_before_writing(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            reference = root / "reference.png"
            implementation = root / "implementation.png"
            prefix = root / "review"
            Image.new("RGB", (10, 10)).save(reference)
            Image.new("RGB", (9, 10)).save(implementation)

            with self.assertRaisesRegex(ValueError, "same dimensions"):
                create_visual_review(reference, implementation, prefix)

            self.assertEqual(list(root.glob("review-*.png")), [])


if __name__ == "__main__":
    unittest.main()
