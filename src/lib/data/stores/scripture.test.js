import { beforeEach, describe, expect, it, test, vi } from 'vitest';
import { selectedVerses } from './scripture';

// src/lib/data/stores/scripture.test.js

// Mock config
vi.mock('../config', () => ({
    default: {
        bookCollections: [
            {
                id: 'col1',
                features: {
                    'ref-chapter-verse-separator': ':',
                    'ref-verse-range-separator': '-',
                    'ref-verse-list-separator': ','
                },
                books: [{ id: 'GEN', name: 'Genesis' }],
                style: { font: 'Arial' },
                fonts: ['Arial']
            }
        ],
        fonts: [{ family: 'Arial' }]
    }
}));

// Mock refs store to always return the same reference
vi.mock('./reference', () => ({
    referenceStore: () => ({
        subscribe: (fn) => {
            fn({
                docSet: 'ds1',
                collection: 'col1',
                book: 'GEN',
                chapter: '1',
                verse: '1'
            });
            return () => {};
        },
        set: () => {},
        reset: () => {}
    })
}));

// Mock getVerseText to return predictable text
vi.mock('./getVerseText', () => ({
    getVerseText: vi.fn(async (item) => `Verse ${item.verse} text`)
}));
// Mock getVerseText to return predictable text
// vi.mock('./scripture', async (importOriginal) => {
//   const actual = await importOriginal();
//   return {
//     ...actual,
//     getVerseText: vi.fn(async (item) => `Verse ${item.verse} text`)
//   };
// });

describe('selectedVerses.getCompositeReference', () => {
    beforeEach(() => {
        selectedVerses.reset();
    });

    it('returns correct reference for a single verse', () => {
        selectedVerses.addVerse('1');
        expect(selectedVerses.getCompositeReference()).toBe('Genesis 1:1');
    });

    it('returns correct reference for consecutive verses', () => {
        selectedVerses.addVerse('1');
        selectedVerses.addVerse('2');
        selectedVerses.addVerse('3');
        expect(selectedVerses.getCompositeReference()).toBe('Genesis 1:1-3');
    });

    it('returns correct reference for non-consecutive verses', () => {
        selectedVerses.addVerse('1');
        selectedVerses.addVerse('3');
        selectedVerses.addVerse('5');
        expect(selectedVerses.getCompositeReference()).toBe('Genesis 1:1, 3, 5');
    });

    it('returns correct reference for mixed consecutive and non-consecutive verses', () => {
        selectedVerses.addVerse('1');
        selectedVerses.addVerse('2');
        selectedVerses.addVerse('4');
        selectedVerses.addVerse('5');
        expect(selectedVerses.getCompositeReference()).toBe('Genesis 1:1-2, 4-5');
    });

    it('returns correct reference for consecutive then non-consecutive', () => {
        selectedVerses.addVerse('1');
        selectedVerses.addVerse('2');
        selectedVerses.addVerse('4');
        expect(selectedVerses.getCompositeReference()).toBe('Genesis 1:1-2, 4');
    });

    it('returns correct reference for mixed out of order verses', () => {
        selectedVerses.addVerse('1');
        selectedVerses.addVerse('4');
        selectedVerses.addVerse('2');
        selectedVerses.addVerse('5');
        expect(selectedVerses.getCompositeReference()).toBe('Genesis 1:1-2, 4-5');
    });
});

describe('selectedVerses.getFirstAndLastVerseNumbers', () => {
    beforeEach(() => {
        selectedVerses.reset();
    });
    it('returns null for no verses', () => {
        expect(selectedVerses.getFirstAndLastVerseNumbers()).toBe(null);
    });
    it('returns correct first and last for single verse', () => {
        selectedVerses.addVerse('3');
        expect(selectedVerses.getFirstAndLastVerseNumbers()).toEqual({ first: '3', last: '3' });
    });
    it('returns correct first and last for multiple verses', () => {
        selectedVerses.addVerse('5');
        selectedVerses.addVerse('2');
        selectedVerses.addVerse('8');
        expect(selectedVerses.getFirstAndLastVerseNumbers()).toEqual({ first: '2', last: '8' });
    });
});

describe('selectedVerses.getCompositeText', () => {
    beforeEach(() => {
        selectedVerses.reset();
    });
    test('returns concatenated text for selected verses', async () => {
        selectedVerses.addVerse(1);
        selectedVerses.addVerse(2);
        const text = await selectedVerses.getCompositeText();
        expect(text).toBe('Verse 1 text Verse 2 text');
    });
});
