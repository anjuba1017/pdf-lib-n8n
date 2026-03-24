# n8n-nodes-pdf-lib-tool

Edit PDF files in n8n workflows using `pdf-lib`, with no external API and no system binaries.

## Features

- **Merge Binary PDFs**: Merge multiple binary properties from each item into one PDF.
- **Extract Pages**: Build a new PDF from selected pages using a page range.
- **Rotate Pages**: Rotate all pages or selected pages by 90/180/270 degrees.
- **Remove Pages**: Remove selected pages from a PDF.
- **Add Text**: Draw text on all pages or selected pages.
- **Fill Form**: Fill out fillable fields in the PDF.
- **Custom Code**: Execute custom javascript code on the PDF.
- **Pipeline**: Apply multiple actions in sequence in one node.
- **Runs locally**: Pure JavaScript library (`pdf-lib`) inside your n8n instance.

## Operations

### 1) Merge Binary PDFs

- Input: multiple binary properties in one item (example: `data, attachment1, attachment2`)
- Output: single merged PDF in your selected output binary property

### 2) Extract Pages

- Input: one source PDF binary property
- Parameter: `Pages` (example: `1-3,5,8-10`)
- Output: new PDF containing only selected pages

### 3) Rotate Pages

- Input: one source PDF binary property
- Parameters:
  - `Rotation`: 90, 180, or 270
  - `Pages To Rotate`: optional range (leave empty for all pages)
- Output: rotated PDF

### 4) Remove Pages

- Input: one source PDF binary property
- Parameter: `Pages` (example: `1-3,5,8-10`)
- Output: new PDF with selected pages removed

### 5) Add Text

- Input: one source PDF binary property
- Parameters:
  - `Text`: text to draw
  - `X Position` / `Y Position`: coordinates
  - `Font Size`: text size
  - `Text Rotation`: text rotation
  - `Text Opacity`: text opacity
  - `Text Color (Hex)`: text color
  - `Pages To Add Text`: optional range (leave empty for all pages)
- Output: new PDF with text added

### 6) Fill Form

- Input: one source PDF binary property
- Parameters:
  - `Form Fields`: list of field names and values to fill
- Output: new PDF with form fields filled

### 7) Custom Code

- Input: one source PDF binary property
- Parameters:
  - `Code`: JavaScript code to manipulate the `pdfDoc` object using `pdfLib`
- Output: manipulated PDF

### 8) Pipeline

- Input: one source PDF binary property
- Parameters:
  - `Pipeline Actions`: list of actions to apply in sequence (`Add Text`, `Remove Pages`, `Rotate Pages`)
- Output: new PDF with all actions applied in sequence

## Usage in n8n

1. Add **PDF Lib** node to your workflow.
2. Select **Operation**.
3. Set input/output binary properties.
4. Run the node.

The node returns the processed PDF in binary output and adds operation metadata under `pdfLib` in JSON output.

## License

MIT
