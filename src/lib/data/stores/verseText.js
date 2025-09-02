import { derived, get, writable } from 'svelte/store';
import { pk } from './pk';

export async function getVerseText(item, item2 = undefined) {
    const proskomma = get(pk);
    const scriptureCV =
        item2 !== undefined
            ? item.chapter === item2.chapter
                ? `${item.chapter}:${item.verse}-${item2.verse}`
                : `${item.chapter}:${item.verse}-${item2.chapter}:${item2.verse}`
            : `${item.chapter}:${item.verse}`;
    //console.log('getVerseText', scriptureCV);
    const query = `{
      docSet (id: "${item.docSet}") {
          document(bookCode:"${item.book}") {
              mainSequence {
                  blocks(withScriptureCV: "${scriptureCV}") {
                      text(withScriptureCV: "${scriptureCV}" normalizeSpace:true )
                  }
              }
          }
      }
  }`;
    //console.log(query);

    const { data } = await proskomma.gqlQuery(query);
    let text = [];
    for (const block of data.docSet.document.mainSequence.blocks) {
        if (block.text) {
            text.push(block.text);
        }
    }
    return text.join(' ');
}
