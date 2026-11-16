import { LANGUAGES, type Language, type ReadingOptions, type ReadingRange, type SourceLanguage } from './reader-messages';

type Props = { value: ReadingOptions; change: (value: ReadingOptions) => void; locked?: boolean };
const languages = Object.entries(LANGUAGES);

export function LanguageFields({ value, change, locked }: Props) {
  return <fieldset className="language-fields" disabled={locked}>
    <label>原文语言
      <select value={value.source} onChange={(event) => change({ ...value, source: event.target.value as SourceLanguage })}>
        <option value="auto">自动检测</option>
        {languages.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
      </select>
    </label>
    <label>译文语言
      <select value={value.target} onChange={(event) => change({ ...value, target: event.target.value as Language })}>
        {languages.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
      </select>
    </label>
    <label className="full">翻译范围
      <select value={value.range} onChange={(event) => change({ ...value, range: event.target.value as ReadingRange })}>
        <option value="visible">整页可见文字</option>
        <option value="main">仅正文</option>
      </select>
    </label>
  </fieldset>;
}
