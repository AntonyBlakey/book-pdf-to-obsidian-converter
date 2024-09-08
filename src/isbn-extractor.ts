import fs from 'fs/promises';
import pdfParse from 'pdf-parse';
import axios, { AxiosError } from 'axios';
import dotenv from 'dotenv';

// Load environment variables from .env
dotenv.config();

const apiKey = process.env.OPENAI_API_KEY;

export async function extractTextFromPDF(pdfPath: string, pages: number): Promise<string> {
    const fileBuffer = await fs.readFile(pdfPath);
    const data = await pdfParse(fileBuffer, {
        pagerender: (pageData: any) => {
            if (pageData.pageIndex < pages) {
                return pageData.getTextContent().then((textContent: { items: any[]; }) => {
                    return textContent.items.map((item) => item.str).join(' ');
                });
            }
            return '';
        }
    });

    return data.text;
}

export type Result = {
    "title": string;
    "edition": number;
    "ISBNs": string[];
};

export async function extractTitleEditionAndISBNs(text: string): Promise<Result> {
    const systemMessage = `
        You are a helpful assistant that can find the title, edition number and ISBNs from the text of a book.
        You will return your results as JSON without any markdown.
        You will return the edition number as an integer, separately from the title.
        You will only return ISBNs that are actually present in the text, and that are in valid ISBN10 or ISBN13 format.
    `;

    const prompt = `Here is the text extracted from a book. Can you extract the title, edition and ISBNs for me? ${text}`;

    try {
        return JSON.parse(await callOpenAI('gpt-4o-mini', systemMessage, prompt)) as Result;
    } catch (error: any) {
        throw new Error('Failed to extract ISBN from the text.');
    }
}

type VolumeInfo = {
    title: string;
    subtitle?: string;
    authors?: string[];
    publisher?: string;
    publishedDate?: string;
    description?: string;
    industryIdentifiers?: { type: string; identifier: string }[];
    readingModes?: { text: boolean; image: boolean };
    pageCount?: number;
    printType?: string;
    categories?: string[];
    maturityRating?: string;
    allowAnonLogging?: boolean;
    contentVersion?: string;
    imageLinks?: {
        smallThumbnail?: string;
        thumbnail?: string;
    };
    language?: string;
    previewLink?: string;
    infoLink?: string;
    canonicalVolumeLink?: string;
};

export async function fetchVolumeInfos(title: string, isbns: string[]): Promise<VolumeInfo[]> {
    const bestMatches = await Promise.all(isbns.map(async (isbn) => {
        const queryUrl = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`;
        try {
            const response = await axios.get(queryUrl);
            const items: VolumeInfo[] = response.data.items.map((item: any) => item.volumeInfo) || [];
            return items;
        } catch (error) {
            console.error(`Error querying Google Books API for ISBN ${isbn}:`, error);
            return [];
        }
    }));

    if (bestMatches.length == 0) {
        try {
            const queryUrl = `https://www.googleapis.com/books/v1/volumes?q=title:${title}`;
            const response = await axios.get(queryUrl);
            const items: VolumeInfo[] = response.data.items.map((item: any) => item.volumeInfo) || [];
            bestMatches.push(items);
        } catch (error) {
            console.error(`Error querying Google Books API for Title ${title}:`, error);
        }
    }

    return bestMatches.flat();
}

type BookInfo = {
    title: string;
    subtitle: string;
    edition: number;
    authors: string[];
    publisher: string;
    publishedDate: Date;
    description: string;
    isbn10: string;
    isbn13: string;
    pageCount: number;
    thumbnailLink: string;
    previewLink: string;
};

export async function findBestMatchingVolumeInfo(title: string, edition: number, volumeInfos: VolumeInfo[]): Promise<VolumeInfo> {
    const systemMessage = `
        You are a helpful assistant that given a title and edition number can select the best matching record
        from a list of possible matches generated by the google book search api.
        You will return your result as the number of the best match record in the list, as an integer, without any markdown.
    `;

    const bookList =
        volumeInfos.map((volumeInfo, index) => (
            `Book ${index + 1}: ${JSON.stringify(volumeInfo)}`
        )).join('\n\n');

    const prompt = `
        Given the following list of possible matches
        ${bookList}
        Find the best match for the following title and edition number:
        Title: ${title}
        Edition: ${edition}
    `;

    try {
        const response = await callOpenAI('gpt-4o-mini', systemMessage, prompt);
        const choiceIndex = parseInt(response.replace(/[^\d]/g, ''), 10) - 1;
        return volumeInfos[choiceIndex];
    } catch (error: any) {
        throw new Error('Failed to find the best matching book using OpenAI.');
    }
}

export async function convertVolumeInfoToeBookInfo(volumeInfo: VolumeInfo, edition: number): Promise<Partial<BookInfo>> {
    const result: Partial<BookInfo> = { edition };

    if (volumeInfo.title) result.title = volumeInfo.title;
    if (volumeInfo.subtitle) result.subtitle = volumeInfo.subtitle;
    if (volumeInfo.authors) result.authors = volumeInfo.authors;
    if (volumeInfo.publisher) result.publisher = volumeInfo.publisher;
    if (volumeInfo.publishedDate) result.publishedDate = new Date(volumeInfo.publishedDate);
    if (volumeInfo.description) result.description = await descriptionToMarkdown(volumeInfo.description);
    if (volumeInfo.pageCount) result.pageCount = volumeInfo.pageCount;
    if (volumeInfo.previewLink) result.previewLink = volumeInfo.previewLink;
    if (volumeInfo.imageLinks?.thumbnail) result.thumbnailLink = volumeInfo.imageLinks.thumbnail;

    if (volumeInfo.industryIdentifiers) {
        volumeInfo.industryIdentifiers.forEach(identifier => {
            if (identifier.type === 'ISBN_10') {
                result.isbn10 = identifier.identifier;
            } else if (identifier.type === 'ISBN_13') {
                result.isbn13 = identifier.identifier;
            }
        });
    }

    return result;
}

async function descriptionToMarkdown(description: string): Promise<string> {
    const systemMessage = `
        You are a helpful assistant that can reorganize text into structured Markdown format.
    `;

    const prompt = `
        Given the following description of a book, restructure it into structured Markdown format.
        It should not include the title, authors, or a top level heading such as "Description".
        "${description}"
    `;

    try {
        return await callOpenAI('gpt-4o', systemMessage, prompt, 0.7);
    } catch (error: any) {
        throw new Error('Failed to convert description to markdown.');
    }
}

interface OpenAIResponse {
    choices: { message: { content: string } }[];
}

async function callOpenAI(model: string, systemMessage: string, prompt: string, temperature: number = 0.0): Promise<string> {
    try {
        const response = await axios.post<OpenAIResponse>(
            'https://api.openai.com/v1/chat/completions',
            {
                model,
                messages: [
                    { role: 'system', content: systemMessage },
                    { role: 'user', content: prompt }
                ],
                max_tokens: 16000,
                temperature
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        return response.data.choices[0].message.content;
    } catch (error: unknown) {
        if (axios.isAxiosError(error)) {
            handleAxiosError(error);
        } else {
            console.error('Unexpected error:', error);
        }
        throw new Error('Failed when calling OpenAI API.');
    }
}

function handleAxiosError(error: AxiosError): void {
    if (error.response) {
        console.error('Error response from OpenAI API:', error.response.data);
        console.error('Status code:', error.response.status);
        console.error('Headers:', error.response.headers);
    } else if (error.request) {
        console.error('No response received from OpenAI API:', error.request);
    } else {
        console.error('Error in setting up request:', error.message);
    }
}