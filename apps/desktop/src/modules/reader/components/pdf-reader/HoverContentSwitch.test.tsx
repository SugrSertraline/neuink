// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { HoverContentSwitch } from './HoverContentSwitch';
afterEach(cleanup);
function Fixture({ label }: { label: string }) {
  const [checked, setChecked] = useState(true);
  const [sentence, setSentence] = useState(false);
  return <HoverContentSwitch label={label} checked={checked} sentence={sentence} disabled={false}
    onVisibilityChange={setChecked} onSentenceChange={setSentence} />;
}
it.each(['解析后原文', '译文'])('shows the current %s mode and preserves it while disabled', label => {
  const content = label === '译文' ? '译文' : '原文';
  render(<Fixture label={label} />);
  expect(screen.getByText(`显示整段${content}`)).toBeTruthy();
  fireEvent.click(screen.getByRole('switch', { name: `${label}逐句显示` }));
  expect(screen.getByText(`显示逐句${content}`)).toBeTruthy();
  expect(screen.getByRole('switch', { name: label }).getAttribute('aria-checked')).toBe('true');
  fireEvent.click(screen.getByRole('switch', { name: label }));
  expect(screen.getByText(`${content}已关闭`)).toBeTruthy();
  expect((screen.getByRole('switch', { name: `${label}逐句显示` }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('switch', { name: label }));
  expect(screen.getByText(`显示逐句${content}`)).toBeTruthy();
});
