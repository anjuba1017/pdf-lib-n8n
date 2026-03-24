import { degrees, PDFDocument, StandardFonts, rgb, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup } from 'pdf-lib';
import * as pdfLibModule from 'pdf-lib';
import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { ApplicationError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

function parsePageRange(pageRange: string, totalPages: number): number[] {
	const tokens = pageRange
		.split(',')
		.map((token) => token.trim())
		.filter((token) => token.length > 0);

	if (tokens.length === 0) {
		throw new ApplicationError('Page range cannot be empty');
	}

	const pages = new Set<number>();

	for (const token of tokens) {
		if (token.includes('-')) {
			const [startRaw, endRaw] = token.split('-').map((part) => part.trim());
			const start = Number(startRaw);
			const end = Number(endRaw);

			if (!Number.isInteger(start) || !Number.isInteger(end)) {
				throw new ApplicationError(`Invalid page range token "${token}"`);
			}

			if (start < 1 || end < 1 || start > totalPages || end > totalPages) {
				throw new ApplicationError(
					`Page range "${token}" is outside valid bounds 1-${totalPages}`,
				);
			}

			if (start > end) {
				throw new ApplicationError(`Invalid page range "${token}". Start must be <= end`);
			}

			for (let page = start; page <= end; page++) {
				pages.add(page - 1);
			}
		} else {
			const page = Number(token);
			if (!Number.isInteger(page) || page < 1 || page > totalPages) {
				throw new ApplicationError(`Invalid page "${token}". Valid bounds are 1-${totalPages}`);
			}
			pages.add(page - 1);
		}
	}

	return [...pages].sort((a, b) => a - b);
}

function parseHexColor(colorHex: string): { r: number; g: number; b: number } {
	const normalized = colorHex.trim().replace('#', '');
	if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
		throw new ApplicationError(`Invalid color "${colorHex}". Expected format is #RRGGBB.`);
	}

	const r = Number.parseInt(normalized.slice(0, 2), 16) / 255;
	const g = Number.parseInt(normalized.slice(2, 4), 16) / 255;
	const b = Number.parseInt(normalized.slice(4, 6), 16) / 255;
	return { r, g, b };
}

function getPageIndicesForOptionalRange(pageRange: string, totalPages: number): number[] {
	return pageRange.trim().length > 0
		? parsePageRange(pageRange, totalPages)
		: Array.from({ length: totalPages }, (_, idx) => idx);
}

type PipelineAction =
	| {
			actionType: 'rotatePages';
			rotation?: number;
			pageRange?: string;
	  }
	| {
			actionType: 'removePages';
			pageRange?: string;
	  }
	| {
			actionType: 'addText';
			text?: string;
			textX?: number;
			textY?: number;
			fontSize?: number;
			textRotation?: number;
			textOpacity?: number;
			textColorHex?: string;
			pageRange?: string;
	  };

async function applyRotatePagesAction(
	pdfDoc: PDFDocument,
	rotation: number,
	pageRange: string,
): Promise<number> {
	const allPages = pdfDoc.getPages();
	const indicesToRotate = getPageIndicesForOptionalRange(pageRange, allPages.length);

	for (const pageIndex of indicesToRotate) {
		const page = allPages[pageIndex];
		const existing = page.getRotation().angle;
		page.setRotation(degrees((existing + rotation) % 360));
	}

	return indicesToRotate.length;
}

async function applyRemovePagesAction(
	pdfDoc: PDFDocument,
	pageRange: string,
): Promise<{ updatedDoc: PDFDocument; remainingPages: number }> {
	const pagesToRemove = new Set(parsePageRange(pageRange, pdfDoc.getPageCount()));
	const outputPdf = await PDFDocument.create();
	const keepIndices = pdfDoc.getPageIndices().filter((idx) => !pagesToRemove.has(idx));

	if (keepIndices.length === 0) {
		throw new ApplicationError('Cannot remove all pages. At least one page must remain.');
	}

	const copiedPages = await outputPdf.copyPages(pdfDoc, keepIndices);
	for (const page of copiedPages) {
		outputPdf.addPage(page);
	}

	return { updatedDoc: outputPdf, remainingPages: keepIndices.length };
}

async function applyAddTextAction(
	pdfDoc: PDFDocument,
	params: {
		text: string;
		x: number;
		y: number;
		fontSize: number;
		rotation: number;
		opacity: number;
		colorHex: string;
		pageRange: string;
	},
): Promise<number> {
	const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
	const color = parseHexColor(params.colorHex);
	const allPages = pdfDoc.getPages();
	const targetIndices = getPageIndicesForOptionalRange(params.pageRange, allPages.length);

	for (const pageIndex of targetIndices) {
		const page = allPages[pageIndex];
		page.drawText(params.text, {
			x: params.x,
			y: params.y,
			size: params.fontSize,
			font,
			color: rgb(color.r, color.g, color.b),
			rotate: degrees(params.rotation),
			opacity: params.opacity,
		});
	}

	return targetIndices.length;
}

export class PdfLib implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'PDF Lib',
		name: 'pdfLib',
		icon: 'file:pdfLib.svg',
		group: ['transform'],
		version: [1],
		description:
			'Edit PDFs in n8n using pdf-lib (merge, extract, rotate, remove pages, add text, fill form, custom code, pipeline)',
		defaults: {
			name: 'PDF Lib',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				options: [
					{
						name: 'Add Text',
						value: 'addText',
						description: 'Draw text on all pages or selected pages',
						action: 'Add text to PDF',
					},
					{
						name: 'Custom Code',
						value: 'customCode',
						description: 'Execute custom javascript code on the PDF',
						action: 'Execute custom code on PDF',
					},
					{
						name: 'Extract Pages',
						value: 'extractPages',
						description: 'Create a new PDF with selected pages',
						action: 'Extract selected pages from PDF',
					},
					{
						name: 'Fill Form',
						value: 'fillForm',
						description: 'Fill out fillable fields in the PDF',
						action: 'Fill form fields in PDF',
					},
					{
						name: 'Merge Binary PDFs',
						value: 'mergePdfs',
						description: 'Merge multiple binary properties into one PDF',
						action: 'Merge binary pdfs',
					},
					{
						name: 'Pipeline',
						value: 'pipeline',
						description: 'Apply multiple actions in sequence in one node',
						action: 'Apply multiple actions to PDF',
					},
					{
						name: 'Remove Pages',
						value: 'removePages',
						description: 'Remove selected pages from a PDF',
						action: 'Remove selected pages from PDF',
					},
					{
						name: 'Rotate Pages',
						value: 'rotatePages',
						description: 'Rotate all or selected pages in a PDF',
						action: 'Rotate pages in PDF',
					},
				],
				default: 'mergePdfs',
				noDataExpression: true,
			},
			{
				displayName: 'Binary Property Names',
				name: 'binaryPropertyNames',
				type: 'string',
				default: 'data',
				description:
					'Comma-separated binary property names to merge in order (for example: data, attachment1, attachment2)',
				displayOptions: {
					show: {
						operation: ['mergePdfs'],
					},
				},
			},
			{
				displayName: 'Output Binary Property',
				name: 'outputBinaryPropertyName',
				type: 'string',
				default: 'data',
				description: 'Binary property where the output PDF will be stored',
			},
			{
				displayName: 'Input Binary Property',
				name: 'inputBinaryPropertyName',
				type: 'string',
				default: 'data',
				description: 'Binary property containing the source PDF',
				displayOptions: {
					show: {
						operation: [
							'addText',
							'customCode',
							'extractPages',
							'fillForm',
							'pipeline',
							'removePages',
							'rotatePages',
						],
					},
				},
			},
			{
				displayName: 'Pages',
				name: 'pageRange',
				type: 'string',
				default: '1-2',
				placeholder: '1-3,5,8-10',
				description:
					'Pages to use, with 1-based indexing. Examples: 1-3,5,8-10.',
				displayOptions: {
					show: {
						operation: ['extractPages', 'removePages'],
					},
				},
			},
			{
				displayName: 'Rotation',
				name: 'rotation',
				type: 'options',
				options: [
					{ name: '90°', value: 90 },
					{ name: '180°', value: 180 },
					{ name: '270°', value: 270 },
				],
				default: 90,
				description: 'Clockwise rotation angle',
				displayOptions: {
					show: {
						operation: ['rotatePages'],
					},
				},
			},
			{
				displayName: 'Pages To Rotate',
				name: 'rotatePageRange',
				type: 'string',
				default: '',
				placeholder: 'Leave empty for all pages, or e.g. 1-3,5',
				description:
					'Optional range of pages to rotate. Leave empty to rotate all pages.',
				displayOptions: {
					show: {
						operation: ['rotatePages'],
					},
				},
			},
			{
				displayName: 'Pages To Add Text',
				name: 'textPageRange',
				type: 'string',
				default: '',
				placeholder: 'Leave empty for all pages, or e.g. 1-3,5',
				description: 'Optional range of pages to add text. Leave empty to use all pages.',
				displayOptions: {
					show: {
						operation: ['addText'],
					},
				},
			},
			{
				displayName: 'Code',
				name: 'customCode',
				type: 'string',
				typeOptions: {
					alwaysOpenEditWindow: true,
					editor: 'jsEditor',
				},
				default: '// The document is available as "pdfDoc"\n// The pdf-lib module is available as "pdfLib"\n// The current input item is available as "item"\n// Example:\n// const pages = pdfDoc.getPages();\n// pages[0].drawText(item.json.myText || "Hello", { x: 50, y: 50 });',
				description: 'Custom JavaScript code to manipulate the PDF Document',
				displayOptions: {
					show: {
						operation: ['customCode'],
					},
				},
			},
			{
				displayName: 'Form Fields',
				name: 'formFields',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				default: {},
				description: 'The fields to fill in the PDF',
				displayOptions: {
					show: {
						operation: ['fillForm'],
					},
				},
				options: [
					{
						name: 'fields',
						displayName: 'Field',
						values: [
							{
								displayName: 'Field Name',
								name: 'name',
								type: 'string',
								default: '',
								description: 'Name of the form field',
							},
							{
								displayName: 'Field Value',
								name: 'value',
								type: 'string',
								default: '',
								description: 'Value to fill in the form field. For checkboxes use "true" or "false".',
							},
						],
					},
				],
			},
			{
				displayName: 'Text',
				name: 'text',
				type: 'string',
				default: 'TEST',
				description: 'Text to draw on each selected page',
				displayOptions: {
					show: {
						operation: ['addText'],
					},
				},
			},
			{
				displayName: 'X Position',
				name: 'textX',
				type: 'number',
				default: 50,
				description: 'Horizontal position in PDF points',
				displayOptions: {
					show: {
						operation: ['addText'],
					},
				},
			},
			{
				displayName: 'Y Position',
				name: 'textY',
				type: 'number',
				default: 700,
				description: 'Vertical position in PDF points',
				displayOptions: {
					show: {
						operation: ['addText'],
					},
				},
			},
			{
				displayName: 'Font Size',
				name: 'fontSize',
				type: 'number',
				default: 24,
				description: 'Font size for the drawn text',
				displayOptions: {
					show: {
						operation: ['addText'],
					},
				},
			},
			{
				displayName: 'Text Rotation',
				name: 'textRotation',
				type: 'number',
				default: 0,
				description: 'Text rotation angle in degrees',
				displayOptions: {
					show: {
						operation: ['addText'],
					},
				},
			},
			{
				displayName: 'Text Opacity',
				name: 'textOpacity',
				type: 'number',
				typeOptions: {
					minValue: 0,
					maxValue: 1,
					numberPrecision: 2,
				},
				default: 1,
				description: 'Text opacity from 0 to 1',
				displayOptions: {
					show: {
						operation: ['addText'],
					},
				},
			},
			{
				displayName: 'Text Color (Hex)',
				name: 'textColorHex',
				type: 'color',
				default: '#000000',
				description: 'Color in #RRGGBB format',
				displayOptions: {
					show: {
						operation: ['addText'],
					},
				},
			},
			{
				displayName: 'Pipeline Actions',
				name: 'pipelineActions',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				default: {},
				description: 'Actions executed in order on the same PDF',
				displayOptions: {
					show: {
						operation: ['pipeline'],
					},
				},
				options: [
					{
						name: 'actions',
						displayName: 'Action',
						values: [
							{
						displayName: 'Action Type',
						name: 'actionType',
						type: 'options',
						options: [
									{
										name: 'Add Text',
										value: 'addText',
									},
									{
										name: 'Remove Pages',
										value: 'removePages',
									},
									{
										name: 'Rotate Pages',
										value: 'rotatePages',
									},
								],
						default: 'rotatePages',
						description: 'Action to execute in this pipeline step',
							},
							{
						displayName: 'Font Size',
						name: 'fontSize',
						type: 'number',
						default: 24,
						description: 'Font size used when action type is add text',
							},
							{
						displayName: 'Pages',
						name: 'pageRange',
						type: 'string',
						default: '',
						placeholder: 'Leave empty for all pages, or e.g. 1-3,5',
						description: 'Optional page range for this action',
							},
							{
						displayName: 'Rotation',
						name: 'rotation',
						type: 'options',
						options: [
									{
										name: '90°',
										value: 90
									},
									{
										name: '180°',
										value: 180
									},
									{
										name: '270°',
										value: 270
									},
					],
						default: 90,
						description: 'Rotation used when action type is rotate pages',
							},
							{
						displayName: 'Text',
						name: 'text',
						type: 'string',
						default: 'TEST',
						description: 'Text used when action type is add text',
							},
							{
						displayName: 'Text Color (Hex)',
						name: 'textColorHex',
						type: 'color',
						default: '#000000',
						description: 'Text color used when action type is add text',
							},
							{
						displayName: 'Text Opacity',
						name: 'textOpacity',
						type: 'number',
						default: 1,
						description: 'Text opacity used when action type is add text',
							},
							{
						displayName: 'Text Rotation',
						name: 'textRotation',
						type: 'number',
						default: 0,
						description: 'Text rotation used when action type is add text',
							},
							{
						displayName: 'X Position',
						name: 'textX',
						type: 'number',
						default: 50,
						description: 'X position used when action type is add text',
							},
							{
						displayName: 'Y Position',
						name: 'textY',
						type: 'number',
						default: 700,
						description: 'Y position used when action type is add text',
							},
					],
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const item = items[i];
				const operation = this.getNodeParameter('operation', i) as string;
				const outputBinaryPropertyName = this.getNodeParameter(
					'outputBinaryPropertyName',
					i,
					'data',
				) as string;

				let outputBuffer: Buffer;
				let outputFileName = 'document.processed.pdf';
				let operationMeta: Record<string, unknown> = {};

				if (operation === 'mergePdfs') {
					const binaryPropertyNamesRaw = this.getNodeParameter(
						'binaryPropertyNames',
						i,
						'data',
					) as string;
					const binaryPropertyNames = binaryPropertyNamesRaw
						.split(',')
						.map((name) => name.trim())
						.filter((name) => name.length > 0);

					if (binaryPropertyNames.length < 1) {
						throw new NodeOperationError(this.getNode(), 'No binary property names provided', {
							itemIndex: i,
						});
					}

					const mergedPdf = await PDFDocument.create();
					let mergedPageCount = 0;
					let sourceFiles = 0;

					for (const propertyName of binaryPropertyNames) {
						if (!item.binary?.[propertyName]) {
							throw new NodeOperationError(
								this.getNode(),
								`Binary property "${propertyName}" was not found`,
								{ itemIndex: i },
							);
						}

						const sourceBuffer = await this.helpers.getBinaryDataBuffer(i, propertyName);
						const sourcePdf = await PDFDocument.load(sourceBuffer);
						const pageIndices = sourcePdf.getPageIndices();
						const copiedPages = await mergedPdf.copyPages(sourcePdf, pageIndices);

						for (const page of copiedPages) {
							mergedPdf.addPage(page);
						}

						mergedPageCount += copiedPages.length;
						sourceFiles += 1;
					}

					outputBuffer = Buffer.from(await mergedPdf.save());
					outputFileName = `merged-${Date.now()}.pdf`;
					operationMeta = {
						operation: 'mergePdfs',
						sourceFiles,
						totalPages: mergedPageCount,
					};
				} else if (operation === 'extractPages') {
					const inputBinaryPropertyName = this.getNodeParameter(
						'inputBinaryPropertyName',
						i,
						'data',
					) as string;
					const pageRange = this.getNodeParameter('pageRange', i, '1-2') as string;

					if (!item.binary?.[inputBinaryPropertyName]) {
						throw new NodeOperationError(
							this.getNode(),
							`Binary property "${inputBinaryPropertyName}" was not found`,
							{ itemIndex: i },
						);
					}

					const sourceBuffer = await this.helpers.getBinaryDataBuffer(i, inputBinaryPropertyName);
					const sourcePdf = await PDFDocument.load(sourceBuffer);
					const pageIndices = parsePageRange(pageRange, sourcePdf.getPageCount());

					const outputPdf = await PDFDocument.create();
					const copiedPages = await outputPdf.copyPages(sourcePdf, pageIndices);
					for (const page of copiedPages) {
						outputPdf.addPage(page);
					}

					outputBuffer = Buffer.from(await outputPdf.save());
					outputFileName = `extracted-${Date.now()}.pdf`;
					operationMeta = {
						operation: 'extractPages',
						pageRange,
						extractedPages: copiedPages.length,
					};
				} else if (operation === 'rotatePages') {
					const inputBinaryPropertyName = this.getNodeParameter(
						'inputBinaryPropertyName',
						i,
						'data',
					) as string;
					const rotation = this.getNodeParameter('rotation', i, 90) as number;
					const rotatePageRange = this.getNodeParameter('rotatePageRange', i, '') as string;

					if (!item.binary?.[inputBinaryPropertyName]) {
						throw new NodeOperationError(
							this.getNode(),
							`Binary property "${inputBinaryPropertyName}" was not found`,
							{ itemIndex: i },
						);
					}

					const sourceBuffer = await this.helpers.getBinaryDataBuffer(i, inputBinaryPropertyName);
					const pdfDoc = await PDFDocument.load(sourceBuffer);
					const allPages = pdfDoc.getPages();
					const indicesToRotate =
						rotatePageRange.trim().length > 0
							? parsePageRange(rotatePageRange, allPages.length)
							: allPages.map((_, index) => index);

					for (const pageIndex of indicesToRotate) {
						const page = allPages[pageIndex];
						const existing = page.getRotation().angle;
						page.setRotation(degrees((existing + rotation) % 360));
					}

					outputBuffer = Buffer.from(await pdfDoc.save());
					outputFileName = `rotated-${Date.now()}.pdf`;
					operationMeta = {
						operation: 'rotatePages',
						rotation,
						rotatedPages: indicesToRotate.length,
					};
				} else if (operation === 'removePages') {
					const inputBinaryPropertyName = this.getNodeParameter(
						'inputBinaryPropertyName',
						i,
						'data',
					) as string;
					const pageRange = this.getNodeParameter('pageRange', i, '1') as string;

					if (!item.binary?.[inputBinaryPropertyName]) {
						throw new NodeOperationError(
							this.getNode(),
							`Binary property "${inputBinaryPropertyName}" was not found`,
							{ itemIndex: i },
						);
					}

					const sourceBuffer = await this.helpers.getBinaryDataBuffer(i, inputBinaryPropertyName);
					const sourcePdf = await PDFDocument.load(sourceBuffer);
					const result = await applyRemovePagesAction(sourcePdf, pageRange);

					outputBuffer = Buffer.from(await result.updatedDoc.save());
					outputFileName = `pages-removed-${Date.now()}.pdf`;
					operationMeta = {
						operation: 'removePages',
						pageRange,
						remainingPages: result.remainingPages,
					};
				} else if (operation === 'addText') {
					const inputBinaryPropertyName = this.getNodeParameter(
						'inputBinaryPropertyName',
						i,
						'data',
					) as string;
					const text = this.getNodeParameter('text', i, 'TEST') as string;
					const textX = this.getNodeParameter('textX', i, 50) as number;
					const textY = this.getNodeParameter('textY', i, 700) as number;
					const fontSize = this.getNodeParameter('fontSize', i, 24) as number;
					const textRotation = this.getNodeParameter('textRotation', i, 0) as number;
					const textOpacity = this.getNodeParameter('textOpacity', i, 1) as number;
					const textColorHex = this.getNodeParameter('textColorHex', i, '#000000') as string;
					const pageRange = this.getNodeParameter('textPageRange', i, '') as string;

					if (!item.binary?.[inputBinaryPropertyName]) {
						throw new NodeOperationError(
							this.getNode(),
							`Binary property "${inputBinaryPropertyName}" was not found`,
							{ itemIndex: i },
						);
					}

					const sourceBuffer = await this.helpers.getBinaryDataBuffer(i, inputBinaryPropertyName);
					const pdfDoc = await PDFDocument.load(sourceBuffer);
					const modifiedPages = await applyAddTextAction(pdfDoc, {
						text,
						x: textX,
						y: textY,
						fontSize,
						rotation: textRotation,
						opacity: textOpacity,
						colorHex: textColorHex,
						pageRange,
					});

					outputBuffer = Buffer.from(await pdfDoc.save());
					outputFileName = `text-added-${Date.now()}.pdf`;
					operationMeta = {
						operation: 'addText',
						text,
						modifiedPages,
					};
				} else if (operation === 'fillForm') {
					const inputBinaryPropertyName = this.getNodeParameter(
						'inputBinaryPropertyName',
						i,
						'data',
					) as string;

					if (!item.binary?.[inputBinaryPropertyName]) {
						throw new NodeOperationError(
							this.getNode(),
							`Binary property "${inputBinaryPropertyName}" was not found`,
							{ itemIndex: i },
						);
					}

					const formFieldsRaw = this.getNodeParameter('formFields', i, {}) as {
						fields?: Array<{ name: string; value: string }>;
					};
					const fieldsToFill = formFieldsRaw.fields ?? [];

					const sourceBuffer = await this.helpers.getBinaryDataBuffer(i, inputBinaryPropertyName);
					const pdfDoc = await PDFDocument.load(sourceBuffer);
					const form = pdfDoc.getForm();
					let filledCount = 0;

					for (const field of fieldsToFill) {
						const pdfField = form.getField(field.name);
						if (pdfField) {
							if (pdfField instanceof PDFTextField) {
								pdfField.setText(field.value);
								filledCount++;
							} else if (pdfField instanceof PDFCheckBox) {
								if (field.value.toLowerCase() === 'true' || field.value === '1') {
									pdfField.check();
								} else {
									pdfField.uncheck();
								}
								filledCount++;
							} else if (pdfField instanceof PDFDropdown) {
								pdfField.select(field.value);
								filledCount++;
							} else if (pdfField instanceof PDFRadioGroup) {
								pdfField.select(field.value);
								filledCount++;
							}
						}
					}

					outputBuffer = Buffer.from(await pdfDoc.save());
					outputFileName = `form-filled-${Date.now()}.pdf`;
					operationMeta = {
						operation: 'fillForm',
						fieldsFilled: filledCount,
					};
				} else if (operation === 'customCode') {
					const inputBinaryPropertyName = this.getNodeParameter(
						'inputBinaryPropertyName',
						i,
						'data',
					) as string;

					const customCode = this.getNodeParameter('customCode', i, '') as string;

					if (!item.binary?.[inputBinaryPropertyName]) {
						throw new NodeOperationError(
							this.getNode(),
							`Binary property "${inputBinaryPropertyName}" was not found`,
							{ itemIndex: i },
						);
					}

					const sourceBuffer = await this.helpers.getBinaryDataBuffer(i, inputBinaryPropertyName);
					const pdfDoc = await PDFDocument.load(sourceBuffer);

					try {
						const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
						const runCustomCode = new AsyncFunction('pdfDoc', 'pdfLib', 'item', customCode);
						await runCustomCode(pdfDoc, pdfLibModule, item);
					} catch (codeError) {
						throw new NodeOperationError(
							this.getNode(),
							`Error in custom code: ${(codeError as Error).message}`,
							{ itemIndex: i },
						);
					}

					outputBuffer = Buffer.from(await pdfDoc.save());
					outputFileName = `custom-code-${Date.now()}.pdf`;
					operationMeta = {
						operation: 'customCode',
					};
				} else if (operation === 'pipeline') {
					const inputBinaryPropertyName = this.getNodeParameter(
						'inputBinaryPropertyName',
						i,
						'data',
					) as string;

					if (!item.binary?.[inputBinaryPropertyName]) {
						throw new NodeOperationError(
							this.getNode(),
							`Binary property "${inputBinaryPropertyName}" was not found`,
							{ itemIndex: i },
						);
					}

					const pipelineActionsRaw = this.getNodeParameter('pipelineActions', i, {}) as {
						actions?: PipelineAction[];
					};
					const pipelineActions = pipelineActionsRaw.actions ?? [];
					if (pipelineActions.length === 0) {
						throw new NodeOperationError(this.getNode(), 'Add at least one pipeline action.', {
							itemIndex: i,
						});
					}

					const sourceBuffer = await this.helpers.getBinaryDataBuffer(i, inputBinaryPropertyName);
					let pdfDoc = await PDFDocument.load(sourceBuffer);
					const pipelineMeta: Array<Record<string, unknown>> = [];

					for (const action of pipelineActions) {
						if (action.actionType === 'rotatePages') {
							const modifiedPages = await applyRotatePagesAction(
								pdfDoc,
								action.rotation ?? 90,
								action.pageRange ?? '',
							);
							pipelineMeta.push({
								actionType: 'rotatePages',
								rotation: action.rotation ?? 90,
								modifiedPages,
							});
						} else if (action.actionType === 'removePages') {
							const pageRange = action.pageRange ?? '';
							if (pageRange.trim().length === 0) {
								throw new NodeOperationError(
									this.getNode(),
									'Pages is required for remove pages in pipeline.',
									{ itemIndex: i },
								);
							}
							const result = await applyRemovePagesAction(pdfDoc, pageRange);
							pdfDoc = result.updatedDoc;
							pipelineMeta.push({
								actionType: 'removePages',
								pageRange,
								remainingPages: result.remainingPages,
							});
						} else if (action.actionType === 'addText') {
							const modifiedPages = await applyAddTextAction(pdfDoc, {
								text: action.text ?? 'TEST',
								x: action.textX ?? 50,
								y: action.textY ?? 700,
								fontSize: action.fontSize ?? 24,
								rotation: action.textRotation ?? 0,
								opacity: action.textOpacity ?? 1,
								colorHex: action.textColorHex ?? '#000000',
								pageRange: action.pageRange ?? '',
							});
							pipelineMeta.push({
								actionType: 'addText',
								text: action.text ?? 'TEST',
								modifiedPages,
							});
						} else {
							throw new NodeOperationError(
								this.getNode(),
								`Unsupported pipeline action "${String((action as { actionType?: string }).actionType)}"`,
								{ itemIndex: i },
							);
						}
					}

					outputBuffer = Buffer.from(await pdfDoc.save());
					outputFileName = `pipeline-${Date.now()}.pdf`;
					operationMeta = {
						operation: 'pipeline',
						steps: pipelineMeta,
					};
				} else {
					throw new NodeOperationError(this.getNode(), `Unsupported operation "${operation}"`, {
						itemIndex: i,
					});
				}

				const outputItem: INodeExecutionData = {
					json: {
						...item.json,
						pdfLib: operationMeta,
					},
					binary: {
						...(item.binary ?? {}),
					},
					pairedItem: {
						item: i,
					},
				};

				outputItem.binary![outputBinaryPropertyName] = await this.helpers.prepareBinaryData(
					outputBuffer,
					outputFileName,
				);

				returnData.push(outputItem);
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: (error as Error).message,
						},
						pairedItem: { item: i },
					});
				} else {
					const err = error as Error & { context?: { itemIndex?: number } };
					if (err.context) {
						err.context.itemIndex = i;
						throw err;
					}
					throw new NodeOperationError(this.getNode(), err, { itemIndex: i });
				}
			}
		}

		return [returnData];
	}
}
