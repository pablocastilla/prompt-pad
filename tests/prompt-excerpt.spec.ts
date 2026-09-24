import { test, expect } from '@playwright/test';
import { promptExcerpt, stripPhraseSpans } from '../electron/promptExcerpt';

test.describe('promptExcerpt task extractor', () => {
  test('skips leading persona and git setup boilerplate paragraphs to extract the core task', () => {
    const prompt = [
      'Eres un experto full stack en python, react y azure. Además eres experto en plantas fotovoltaicas y O&M.',
      '',
      'Vete a la rama develop y haz pull para tener lo último.',
      '',
      'puede ser que a partir de 70 no se puedan almacenar más sesiones en la pestaña de sesiones y por eso o se pueden cerrar?',
      '',
      'Itera hasta que lo tengas, prueba toda la funcionalidad con playwright.',
    ].join('\n');

    const excerpt = promptExcerpt(prompt);
    expect(excerpt).toContain('puede ser que a partir de 70 no se puedan almacenar más sesiones');
    expect(excerpt).not.toContain('Eres un experto');
    expect(excerpt).not.toContain('Vete a la rama develop');
  });

  test('extracts task from explicit marker like Tarea: or Task:', () => {
    const prompt = [
      '# Contexto',
      'Aplicación para gestionar prompts de inteligencia artificial.',
      '',
      '# Tarea: Arreglar el bug de cierre de sesiones en el panel lateral',
      'Actualmente el botón de cerrar no responde cuando hay muchas sesiones.',
    ].join('\n');

    const excerpt = promptExcerpt(prompt);
    expect(excerpt).toContain('Arreglar el bug de cierre de sesiones en el panel lateral');
    expect(excerpt).not.toContain('Aplicación para gestionar');
  });

  test('strips matching saved phrases from the start of the prompt', () => {
    const cabecera = 'Eres un desarrollador experto en TypeScript y Electron.\nReglas del proyecto: no romper compatibilidad.';
    const prompt = cabecera + '\n\nImplementa el soporte para mostrar actividad de Antigravity en tiempo real.';

    const excerpt = promptExcerpt(prompt, 200, [{ content: cabecera }]);
    expect(excerpt).toContain('Implementa el soporte para mostrar actividad de Antigravity');
    expect(excerpt).not.toContain('Eres un desarrollador experto');
  });

  test('handles single-paragraph prompts directly without stripping them', () => {
    expect(promptExcerpt('script test')).toBe('script test');
    expect(promptExcerpt('Fix login bug')).toBe('Fix login bug');
  });

  test('strips double quotes and collapses newlines to preserve PowerShell safety', () => {
    const prompt = 'Fix the "auth" timeout bug\n\nwith extra   spaces\nand newlines';
    const excerpt = promptExcerpt(prompt);
    expect(excerpt).not.toContain('"');
    expect(excerpt).toContain('Fix the auth timeout bug with extra spaces and newlines');
  });

  test('truncates at max limit with an ellipsis', () => {
    const longPrompt = 'A'.repeat(250);
    const excerpt = promptExcerpt(longPrompt, 50);
    expect(excerpt.length).toBeLessThanOrEqual(51);
    expect(excerpt.endsWith('…')).toBe(true);
  });

  test('strips phrase spans at the start of the prompt via phraseRanges', () => {
    const cabecera = 'Eres un desarrollador experto en TypeScript y Electron.\nReglas: no romper compatibilidad.';
    const prompt = cabecera + '\n\nImplementa el nuevo panel de sesiones.';

    const excerpt = promptExcerpt(prompt, 200, undefined, [{ start: 0, end: cabecera.length }]);
    expect(excerpt).toContain('Implementa el nuevo panel de sesiones');
    expect(excerpt).not.toContain('Eres un desarrollador experto');
  });

  test('strips phrase spans anywhere in the prompt, not only at the start', () => {
    const phrase = 'Prueba siempre con Playwright antes de cerrar.';
    const prompt = 'Arregla el bug del login.\n\n' + phrase + '\n\nItera hasta que pase todo.';

    const excerpt = promptExcerpt(prompt, 200, undefined, [{ start: 'Arregla el bug del login.\n\n'.length, end: 'Arregla el bug del login.\n\n'.length + phrase.length }]);
    expect(excerpt).toContain('Arregla el bug del login');
    expect(excerpt).toContain('Itera hasta que pase todo');
    expect(excerpt).not.toContain('Prueba siempre con Playwright');
  });

  test('strips multiple phrase spans in a single pass', () => {
    const phraseA = 'Eres un experto en QA.';
    const phraseB = 'Usa Playwright para las pruebas.';
    const prompt = phraseA + '\n\nArregla el contador de sesiones.\n\n' + phraseB;

    const ranges = [
      { start: 0, end: phraseA.length },
      { start: prompt.length - phraseB.length, end: prompt.length },
    ];
    const excerpt = promptExcerpt(prompt, 200, undefined, ranges);
    expect(excerpt).toContain('Arregla el contador de sesiones');
    expect(excerpt).not.toContain('Eres un experto');
    expect(excerpt).not.toContain('Usa Playwright');
  });

  test('phraseRanges take priority over phrases.json matching', () => {
    const cabecera = 'Eres un experto en React.\nReglas: código limpio.';
    // The saved phrase no longer matches the prompt start exactly (user typed
    // text before it), but the editor still tracks its span.
    const prompt = 'Nota previa.\n' + cabecera + '\n\nArregla el bug de render.';

    const start = 'Nota previa.\n'.length;
    const excerpt = promptExcerpt(prompt, 200, [{ content: cabecera }], [{ start, end: start + cabecera.length }]);
    expect(excerpt).toContain('Arregla el bug de render');
    expect(excerpt).not.toContain('Eres un experto en React');
  });

  test('stripPhraseSpans removes every span safely and ignores invalid ranges', () => {
    expect(stripPhraseSpans('abc', [])).toBe('abc');
    expect(stripPhraseSpans('', [{ start: 0, end: 5 }])).toBe('');
    expect(stripPhraseSpans('hola mundo', [{ start: 4, end: 10 }])).toBe('hola');
    expect(stripPhraseSpans('hola mundo', [{ start: -3, end: 100 }])).toBe('');
    // Invalid entries are ignored without throwing
    expect(stripPhraseSpans('hola mundo', [{ start: 0 }, null as unknown as { start: number; end: number }])).toBe('hola mundo');
  });
});
