// Per-language emotion lexicons. Adding a language = adding one entry here.
// The classifier scans with ALL lexicons regardless of the message's base
// language, which is exactly why code-switching (e.g. Polish text containing
// the English slang "goat" or "haha") is detected correctly.

export const LEXICONS = {
  pl: {
    joy: ['super', 'świetnie', 'swietnie', 'ekstra', 'wspaniale', 'cudownie', 'najlepsze', 'fajnie', 'rewelacja', 'brawo', 'gratulacje', 'spoko', 'ciesz', 'mega'],
    sadness: ['smutno', 'smutny', 'przykro', 'niestety', 'żal', 'zal', 'płacz', 'placz', 'tęsknię', 'tesknie', 'beznadziej', 'słabo', 'slabo'],
    anger: ['wkurzony', 'wkurzona', 'wściekły', 'wsciekly', 'nienawidzę', 'nienawidze', 'denerwuj', 'irytuj', 'do cholery', 'kurcze', 'wkurza'],
    fear: ['boję', 'boje', 'strach', 'przeraż', 'przeraz', 'martwię', 'martwie', 'niepokój', 'niepokoj', 'panika', 'ostrożnie', 'ostroznie'],
    affection: ['kocham', 'kochanie', 'uwielbiam', 'skarbie', 'misiu', 'całuję', 'caluje', 'przytul', 'tęsknię za tobą'],
    surprise: ['serio', 'naprawdę', 'naprawde', 'niemożliwe', 'niemozliwe', 'ojej', 'o matko', 'nie wierzę', 'nie wierze'],
  },
  en: {
    joy: ['awesome', 'great', 'amazing', 'love it', 'nice', 'perfect', 'goat', 'yay', 'cool', 'best', 'congrats', 'wonderful'],
    sadness: ['sad', 'sorry', 'unfortunately', 'miss you', 'depressed', 'terrible', 'awful'],
    anger: ['angry', 'mad', 'hate', 'furious', 'annoyed', 'damn', 'pissed'],
    fear: ['scared', 'afraid', 'worried', 'nervous', 'panic', 'anxious'],
    affection: ['love you', 'love u', 'darling', 'sweetheart', 'xoxo'],
    surprise: ['really', 'no way', 'omg', 'unbelievable', 'whoa'],
  },
};
