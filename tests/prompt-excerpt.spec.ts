import { test, expect } from '@playwright/test';
import { promptExcerpt } from '../electron/promptExcerpt';

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
});
