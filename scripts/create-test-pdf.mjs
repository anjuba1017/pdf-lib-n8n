import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

async function main() {
	const pdfDoc = await PDFDocument.create();
	const page = pdfDoc.addPage([595, 842]); // A4 size in points
	const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

	const text = 'TEST';
	const fontSize = 72;
	const textWidth = font.widthOfTextAtSize(text, fontSize);
	const textHeight = font.heightAtSize(fontSize);
	const x = (page.getWidth() - textWidth) / 2;
	const y = (page.getHeight() - textHeight) / 2;

	page.drawText(text, {
		x,
		y,
		size: fontSize,
		font,
		color: rgb(0, 0, 0),
	});

	const pdfBytes = await pdfDoc.save();
	const outputPath = resolve(process.cwd(), 'test-output.pdf');
	await writeFile(outputPath, pdfBytes);
	console.log(outputPath);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
