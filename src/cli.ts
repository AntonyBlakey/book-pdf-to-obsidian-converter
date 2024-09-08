import { Command } from 'commander';
import { convertVolumeInfoToeBookInfo, extractTextFromPDF, extractTitleEditionAndISBNs, fetchVolumeInfos, findBestMatchingVolumeInfo } from './isbn-extractor.js';

const program = new Command();

program
    .version('1.0.0')
    .description('Extract book information given a PDF file of a book')
    .command('extract <pdfPath>')
    .description('Extract book information given a PDF file of a book')
    .action(async (pdfPath) => {
        try {
            let pages = 4;
            const extractedText = await extractTextFromPDF(pdfPath, pages);
            let result = await extractTitleEditionAndISBNs(extractedText);
            while (result.ISBNs.length == 0 && pages != 16) {
                pages = pages * 2;
                const extractedText = await extractTextFromPDF(pdfPath, pages);
                result = await extractTitleEditionAndISBNs(extractedText);
            }
            let volumeInfos = await fetchVolumeInfos(result.title, result.ISBNs);
            let volumeInfo = await findBestMatchingVolumeInfo(result.title, result.edition, volumeInfos);
            let bookInfo = await convertVolumeInfoToeBookInfo(volumeInfo, result.edition);
            console.log(bookInfo);
        } catch (error) {
            console.error('Error extracting book information:', error);
            process.exit(1);
        }
    });

program.parse(process.argv);