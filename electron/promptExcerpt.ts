export interface SavedPhraseLike {
  content?: string;
}

// Remove the exact spans of the prompt that correspond to inserted saved
// phrases (as tracked by the editor's phraseRanges) so they never leak into
// the session summary, no matter where in the prompt they appear.
export function stripPhraseSpans(prompt: string, ranges?: { start: number; end: number }[]): string {
  if (!prompt || typeof prompt !== 'string' || !Array.isArray(ranges) || ranges.length === 0) {
    return prompt;
  }
  let result = prompt;
  const sorted = [...ranges]
    .filter(r => r && typeof r.start === 'number' && typeof r.end === 'number')
    .sort((a, b) => b.start - a.start);
  for (const r of sorted) {
    const start = Math.max(0, Math.min(r.start, result.length));
    const end = Math.max(0, Math.min(r.end, result.length));
    if (end > start) {
      result = result.slice(0, start) + result.slice(end);
    }
  }
  return result;
}

// Extract a concise, meaningful task excerpt from a prompt.
// Prompts frequently begin with boilerplate: persona definitions ("Eres un experto...",
// "You are a..."), git commands ("Vete a la rama...", "Checkout..."), or headers ("# Contexto").
// We detect and bypass leading boilerplate paragraphs so the session summary describes
// the actual task the user wants solved rather than a generic persona.
export function promptExcerpt(
  prompt: string,
  max = 200,
  phrases?: SavedPhraseLike[],
  phraseRanges?: { start: number; end: number }[],
): string {
  // 0. First drop the exact spans of inserted saved phrases (when the editor
  // tracked them) so phrase content never appears in the summary.
  prompt = stripPhraseSpans(prompt, phraseRanges);

  if (!prompt || typeof prompt !== 'string') return '';

  let cleaned = prompt.replace(/\r\n/g, '\n').replace(/"/g, '').trim();
  if (!cleaned) return '';

  // 1. If saved phrases are passed or known, strip any saved phrase that matches the start
  if (Array.isArray(phrases)) {
    for (const phrase of phrases) {
      const pText = (phrase?.content || '').replace(/\r\n/g, '\n').replace(/"/g, '').trim();
      if (pText && cleaned.startsWith(pText)) {
        cleaned = cleaned.slice(pText.length).trim();
        break;
      }
    }
  }

  // 2. Check for explicit task or objective marker (e.g., "Tarea:", "Task:", "Objetivo:", "Prompt:")
  const explicitMarker = cleaned.match(/(?:^|\n)\s*(?:#+\s*|\*\*)?(?:tarea|task|objetivo|goal|prompt|petici[oó]n|issue|bug|feature|todo|cambio|requerimiento)\b[:\s\-*]*(.*)/i);
  if (explicitMarker) {
    const candidate = cleaned.slice(explicitMarker.index!).replace(/^(?:#+\s*|\*\*)?(?:tarea|task|objetivo|goal|prompt|petici[oó]n|issue|bug|feature|todo|cambio|requerimiento)\b[:\s\-*]*/i, '').trim();
    if (candidate) {
      const flat = candidate.replace(/\s+/g, ' ').trim();
      return flat.length > max ? flat.slice(0, max - 1).trimEnd() + '…' : flat;
    }
  }

  // 3. Find first non-boilerplate paragraph and take text from there onwards
  const personaRegex = /^(?:#+\s*)?(?:eres (?:un|una)|you are (?:a|an)|act (?:as|like)|as an?|asume el rol|tu rol es|your role is|comportate como|compórtate como|imagina que eres|pretend you are|assume the role)\b/i;
  const gitSetupRegex = /^(?:#+\s*)?(?:vete a la rama|cambia a la rama|sit[uú]ate en la rama|checkout\b|haz git pull|haz pull|git checkout|git pull|pull the latest|clona el repo|actualiza la rama|antes de empezar haz pull)\b/i;
  const contextHeaderRegex = /^(?:#+\s*)?(?:contexto|context|reglas|rules|directrices|guidelines|instrucciones generales|general instructions|system instructions)\b[:\s]*$/i;

  const paragraphs = cleaned.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  let startIndex = 0;
  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    if (personaRegex.test(para) || gitSetupRegex.test(para) || contextHeaderRegex.test(para)) {
      startIndex = i + 1;
    } else {
      break;
    }
  }

  const relevantParagraphs = startIndex < paragraphs.length ? paragraphs.slice(startIndex) : paragraphs;
  let text = relevantParagraphs.join(' ');
  text = text.replace(/^[#*>\-\s]+/, '');

  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  return flat.length > max ? flat.slice(0, max - 1).trimEnd() + '…' : flat;
}
