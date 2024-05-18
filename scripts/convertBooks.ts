// eslint-disable-next-line @typescript-eslint/triple-slash-reference
///<reference path="./proskomma.d.ts"/>

import { ConfigData, ConfigTaskOutput, Book } from './convertConfig';
import { TaskOutput, Task, Promisable } from './Task';
import { readFile, readFileSync, writeFile, writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import { SABProskomma } from '../sab-proskomma';
import { queries, postQueries, freeze } from '../sab-proskomma-tools';
import { convertMarkdownsToMilestones } from './convertMarkdown';
import { verifyGlossaryEntries } from './verifyGlossaryEntries';

/**
 * Loops through bookCollections property of configData.
 * Each collection and all associated books are imported into a SABProskomma instance.
 * Each SABProskomma instance is then compressed using proskomma-freeze and written
 * to an associated pkf (ProsKomma Freeze) file to be thawed later in src/routes/data/proskomma.js
 */

function replaceVideoTags(text: string, _bcId: string, _bookId: string): string {
    return text.replace(/\\video (.*)/g, '\\zvideo-s |id="$1"\\*\\zvideo-e\\*');
}

// This is the start of supporting story books, but it still fails if there is no chapter.
function replacePageTags(text: string, _bcId: string, _bookId: string): string {
    return text.replace(/\\page (.*)/g, '\\zpage-s |id="$1"\\*\\zpage-e\\*');
}
function loadGlossary(collection: any, dataDir: string): string[] {
    const glossary: string[] = [];
    for (const book of collection.books) {
        if (book.type && book.type === 'glossary') {
            const glossaryContent = readFileSync(
                path.join(dataDir, 'books', collection.id, book.file),
                'utf8'
            );
            // Regular expression pattern
            const regex = /\\k\s*([^\\]+)\s*\\k\*/g;
            let match;
            // Loop through all matches
            while ((match = regex.exec(glossaryContent)) !== null) {
                // match[1] contains the text between \k and \k*
                glossary.push(match[1]);
            }
        }
    }
    return glossary;
}
function removeStrongNumberReferences(text: string, _bcId: string, _bookId: string): string {
    //remove strong number references
    // \v 1  \w In|strong="H0430"\w* \w the|strong="H0853"\w* \w beginning|strong="H7225"\w*, (Gen 1:1 WEBBE)
    // \v 4  \wj  \+w Blessed|strong="G3107"\+w* \+w are|strong="G3107"\+w* \+w those|strong="G3588"\+w* \+w who|strong="G3588"\+w* \+w mourn|strong="G3996"\+w*,\wj*  (Matt 5:4 WEBBE)
    return text.replace(/(\\\+?w) ([^|]*)\|strong="[^"]*"\1\*/g, '$2');
}

function removeMissingFigures(text: string, _bcId: string, _bookId: string): string {
    // Regular expression to match \fig markers
    const figRegex = /\\fig\s(.*?)\\fig\*/g;

    // Replace each \fig marker with the appropriate action
    return text.replace(figRegex, (match, figContent) => {
        // Split the content of the \fig marker by pipe (|)
        const parts = figContent.split('|');

        // Extract the image source from the first part
        let imageSource;
        if (parts.length < 2) {
            // \fig filename.jpg\fig*
            imageSource = figContent;
        } else if (parts[1].includes('src="')) {
            // \fig Caption|src="filename.jpg"\fig*
            imageSource = parts[1].match(/src="([^"]+)"/)[1];
        } else {
            // \fig Caption|filename.jpg\fig*
            imageSource = parts[1];
        }

        // Check if the image source is missing
        if (isImageMissing(imageSource)) {
            // Image is missing, return an empty string to strip the \fig marker
            return '';
        } else {
            // Image is present, return the original \fig marker
            return match;
        }
    });
}

// Function to check if an image is missing
function isImageMissing(imageSource: string): boolean {
    // Your logic to determine if the image is missing
    // For example, you can use AJAX request to check if the image exists
    // Here, I'm assuming a simple check by presence of src attribute
    return !existsSync(path.join('data', 'illustrations', imageSource));
}

const filterFunctions: ((text: string, bcId: string, bookId: string) => string)[] = [
    removeStrongNumberReferences,
    replaceVideoTags,
    replacePageTags,
    convertMarkdownsToMilestones,
    removeMissingFigures
];

function applyFilters(text: string, bcId: string, bookId: string): string {
    let filteredText = text;
    for (const filterFn of filterFunctions) {
        filteredText = filterFn(filteredText, bcId, bookId);
    }
    return filteredText;
}

type ConvertBookContext = {
    dataDir: string;
    configData: ConfigData;
    verbose: number;
    lang: string;
    docSet: string;
    bcId: string;
};

const unsupportedBookTypes = ['story', 'songs', 'audio-only', 'bloom-player', 'quiz', 'undefined'];
export async function convertBooks(
    dataDir: string,
    configData: ConfigTaskOutput,
    verbose: number
): Promise<BooksTaskOutput> {
    /**book collections from config*/
    const collections = configData.data.bookCollections;
    /**map of docSets and frozen archives*/
    const freezer = new Map<string, any>();
    /**array of catalog query promises*/
    const catalogEntries: Promise<any>[] = [];

    const usedLangs = new Set<string>();
    //loop through collections
    for (const collection of collections!) {
        const pk = new SABProskomma();
        const context: ConvertBookContext = {
            dataDir,
            configData: configData.data,
            verbose,
            lang: collection.languageCode,
            docSet: collection.languageCode + '_' + collection.id,
            bcId: collection.id
        };
        let bcGlossary: string[] = [];
        if (verbose && usedLangs.has(context.lang)) {
            console.warn(
                `Language ${context.lang} already used in another collection. Proceeding anyway.`
            );
        }
        usedLangs.add(context.lang);
        process.stdout.write(`  ${context.bcId}:`);
        if (verbose)
            console.log(
                'converting collection: ' + collection.id + ' to docSet: ' + context.docSet
            );
        /**array of promises of Proskomma mutations*/
        const docs: Promise<void>[] = [];
        //loop through books in collection
        const ignoredBooks = [];
        // If the collection has a glossary, load it
        if (configData.data.traits['has-glossary']) {
            bcGlossary = loadGlossary(collection, dataDir);
        }
        for (const book of collection.books) {
            let bookConverted = false;
            switch (book.type) {
                case 'story':
                case 'songs':
                case 'audio-only':
                case 'bloom-player':
                case 'undefined':
                    break;
                case 'quiz':
                    //bookConverted = true;
                    convertQuizBook(context, book);
                    break;
                default:
                    bookConverted = true;
                    convertScriptureBook(pk, context, book, bcGlossary, docs);
                    break;
            }
            if (!bookConverted) {
                // report which books were ignored at the end
                ignoredBooks.push(book.id);
                continue;
            }
        }
        if (verbose) console.time('convert ' + collection.id);
        //wait for documents to finish being added to Proskomma
        await Promise.all(docs);
        if (ignoredBooks.length > 0) {
            process.stdout.write(` -- Not Supported: ${ignoredBooks.join(' ')}`);
        }
        process.stdout.write('\n');
        if (verbose) console.timeEnd('convert ' + collection.id);
        //start freezing process and map promise to docSet name
        const frozen = freeze(pk);
        freezer.set(context.docSet, frozen[context.docSet]);
        //start catalog generation process
        catalogEntries.push(pk.gqlQuery(queries.catalogQuery({ cv: true })));
    }
    //write catalog entries
    const entries = await Promise.all(catalogEntries);
    const catalogPath = path.join('static', 'collections', 'catalog');
    if (!existsSync(catalogPath)) {
        if (verbose) console.log('creating: ' + catalogPath);
        mkdirSync(catalogPath, { recursive: true });
    }
    entries.forEach((entry) => {
        writeFileSync(
            path.join(catalogPath, entry.data.docSets[0].id + '.json'),
            JSON.stringify(
                postQueries.parseChapterVerseMapInDocSets({
                    docSets: [entry.data.docSets[0]]
                })[0]
            )
        );
    });
    if (verbose) console.time('freeze');
    //write frozen archives for import
    //const vals = await Promise.all(freezer.values());
    //write frozen archives
    const files: any[] = [];

    //push files to be written to files array
    freezer.forEach((value, key) =>
        files.push({
            path: path.join('static', 'collections', key + '.pkf'),
            content: value
        })
    );

    //write index file
    writeFileSync(
        path.join('static', 'collections', 'index.js'),
        `export const collections = [${(() => {
            //export collection names as array
            let s = '';
            let i = 0;
            for (const k of freezer.keys()) {
                s += "'" + k + "'" + (i + 1 < freezer.size ? ', ' : '');
                i++;
            }
            return s;
        })()}];`
    );
    if (verbose) console.timeEnd('freeze');
    return {
        files,
        taskName: 'ConvertBooks'
    };
}

function convertQuizBook(context: ConvertBookContext, book: Book) {
    if (context.verbose) {
        console.log('Converting QuizBook:', book.id);
    }
    //TODO: parse book into QuizBookData and save to /static
}

function convertScriptureBook(
    pk: SABProskomma,
    context: ConvertBookContext,
    book: Book,
    bcGlossary: string[],
    docs: Promise<void>[]
) {
    //push new Proskomma mutation to docs array
    docs.push(
        new Promise<void>((resolve) => {
            //read usfm file
            readFile(
                path.join(context.dataDir, 'books', context.bcId, book.file),
                'utf8',
                (err, content) => {
                    if (err) throw err;
                    process.stdout.write(` ${book.id}`);
                    content = applyFilters(content, context.bcId, book.id);
                    if (context.configData.traits['has-glossary']) {
                        content = verifyGlossaryEntries(content, bcGlossary);
                    }
                    //query Proskomma with a mutation to add a document
                    //more efficient than original pk.addDocument call
                    //as it can be run asynchronously
                    pk.gqlQuery(
                        `mutation {
                            addDocument(
                                selectors: [
                                    {key: "lang", value: "${context.lang}"}, 
                                    {key: "abbr", value: "${context.bcId}"}
                                ], 
                                contentType: "${book.file.split('.').pop()}", 
                                content: """${content}""",
                                tags: [
                                    "sections:${book.section}",
                                    "testament:${book.testament}"
                                ]
                            )
                        }`,
                        (r: any) => {
                            //log if document added successfully
                            if (context.verbose)
                                console.log(
                                    (r.data?.addDocument ? '' : 'failed: ') +
                                        context.docSet +
                                        ' <- ' +
                                        book.name +
                                        ': ' +
                                        path.join(context.dataDir, 'books', context.bcId, book.file)
                                );
                            //if the document is not added successfully, the response returned by Proskomma includes an error message
                            if (!r.data?.addDocument) {
                                const bookPath = path.join(
                                    context.dataDir,
                                    'books',
                                    context.bcId,
                                    book.file
                                );
                                throw Error(
                                    `Adding document, likely not USFM? : ${bookPath}\n${JSON.stringify(
                                        r
                                    )}`
                                );
                            }
                            resolve();
                        }
                    );
                }
            );
        })
    );
}

export interface BooksTaskOutput extends TaskOutput {
    taskName: 'ConvertBooks';
}
/**
 * Internally calls convertBooks, which
 * loops through bookCollections property of configData.
 * Each collection and all associated books are imported into a SABProskomma instance.
 * Each SABProskomma instance is then compressed using proskomma-freeze and written
 * to an associated pkf (ProsKomma Freeze) file to be thawed later in src/routes/data/proskomma.js
 */
export class ConvertBooks extends Task {
    public triggerFiles: string[] = ['books', 'appdef.xml'];
    public static lastBookCollections: ConfigTaskOutput['data']['bookCollections'];
    constructor(dataDir: string) {
        super(dataDir);
    }
    public run(
        verbose: number,
        outputs: Map<string, TaskOutput>,
        modifiedPaths: string[]
    ): Promisable<BooksTaskOutput> {
        const config = outputs.get('ConvertConfig') as ConfigTaskOutput;
        // runs step only if necessary, as the step is fairly expensive
        if (
            !modifiedPaths.some((p) => p.startsWith('books')) &&
            deepCompareObjects(
                ConvertBooks.lastBookCollections,
                config.data.bookCollections,
                new Set(['id', 'books', 'languageCode'])
            )
        ) {
            return {
                taskName: 'ConvertBooks',
                files: []
            };
        }

        const ret = convertBooks(this.dataDir, config, verbose);
        ConvertBooks.lastBookCollections = config.data.bookCollections;
        return ret;
    }
}
/**
 * recursively deep-compares two objects based on properties passed in include.
 */
function deepCompareObjects(obj1: any, obj2: any, include: Set<string> = new Set()): boolean {
    if (typeof obj1 !== typeof obj2) return false;
    if (typeof obj1 === 'object') {
        if (Array.isArray(obj1)) {
            if (obj1.length !== obj2.length) return false;
            for (let i = 0; i < obj1.length; i++) {
                if (!deepCompareObjects(obj1[i], obj2[i])) return false;
            }
        } else {
            for (const k in obj1) {
                if (include.has(k)) {
                    if (!deepCompareObjects(obj1[k], obj2[k])) return false;
                }
            }
        }
    } else {
        return obj1 === obj2;
    }
    return true;
}
