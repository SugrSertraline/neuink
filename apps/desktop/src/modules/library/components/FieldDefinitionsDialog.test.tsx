// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { EntryDefinedFieldValues, EntryFieldsEditor } from './EntryFieldsEditor';
import { useFieldDefinitions } from './FieldDefinitionsDialog';
import { hasUnsavedSegmentEditors, saveSegmentEditorsBeforeClose } from '@/modules/reader/components/segmentEditorDirtyRegistry';
import { readFieldDefinitions, saveFieldDefinitions } from '@/shared/ipc/fieldDefinitionsApi';
vi.mock('@/shared/ipc/fieldDefinitionsApi', () => ({ readFieldDefinitions: vi.fn(async () => [
  { name: '类型', kind: 'select', options: ['期刊', '会议'], hidden: false },
  { name: '收录', kind: 'multi_select', options: ['SCI', 'EI'], hidden: false },
  { name: '日期', kind: 'date', options: [], hidden: false },
]), saveFieldDefinitions: vi.fn(async (_root, _expected, defs) => defs) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
beforeAll(() => { HTMLElement.prototype.scrollIntoView = vi.fn(); });
it('shows a default field without writing until the user enters a value', async () => {
  vi.mocked(readFieldDefinitions).mockResolvedValueOnce([{ name: 'DOI', kind: 'text', options: [], hidden: false }]);
  const changed = vi.fn();
  render(<EntryFieldsEditor workspaceRoot="default-test" fields={[]} onFieldsChange={changed} />);
  expect(await screen.findByText('DOI')).toBeTruthy();
  expect(changed).not.toHaveBeenCalled();
  fireEvent.change(screen.getByPlaceholderText('属性值'), { target: { value: '10.123/test' } });
  expect(changed).toHaveBeenCalledWith([expect.objectContaining({ key: 'DOI', value: '10.123/test' })]);
});
it('uses configured selection and preserves existing multi-select values', async () => {
  const changed = vi.fn();
  render(<EntryFieldsEditor workspaceRoot="test" fields={[{id:'a', key:'类型', value:'期刊'},{id:'b',key:'收录',value:'["SCI"]'}]} onFieldsChange={changed} />);
  await screen.findByRole('combobox', { name: '类型的值' });
  const checkbox = screen.getByRole('checkbox', { name: 'EI' }); fireEvent.click(checkbox);
  expect(changed).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({key:'收录',value:'["SCI","EI"]'})]));
});
it('saves definitions against the loaded baseline and never silently replaces names', async () => {
  render(<EntryFieldsEditor workspaceRoot="test" fields={[]} onFieldsChange={() => {}} />);
  await waitFor(() => expect(readFieldDefinitions).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: '属性管理' }));
  fireEvent.change(screen.getByLabelText('属性名称'), { target: { value: '类型' } });
  fireEvent.click(screen.getByRole('button', { name: '添加属性定义' }));
  expect(screen.getByRole('alert').textContent).toContain('不重复');
  fireEvent.change(screen.getByLabelText('属性名称'), { target: { value: '项目' } });
  fireEvent.click(screen.getByRole('button', { name: '添加属性定义' }));
  fireEvent.click(screen.getByRole('button', { name: '保存属性定义' }));
  await waitFor(() => expect(saveFieldDefinitions).toHaveBeenCalledWith('test', expect.arrayContaining([expect.objectContaining({name:'类型'})]), expect.arrayContaining([expect.objectContaining({name:'项目',kind:'text'})])));
});
it('restores a removed attribute without a recommendation list', async () => {
  render(<EntryFieldsEditor workspaceRoot="test" fields={[]} onFieldsChange={() => {}} />);
  await waitFor(() => expect((screen.getByRole('button', { name: '属性管理' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '属性管理' }));
  const item = screen.getByText('类型 · 单选').parentElement!;
  fireEvent.click(within(item).getByRole('button', { name: '移除' }));
  fireEvent.click(screen.getByRole('button', { name: '恢复 类型' }));
  expect(screen.getByText('类型 · 单选')).toBeTruthy();
  expect(screen.queryByText('推荐属性')).toBeNull();
});
it.each(['title', 'TITLE', 'description', 'Description', '描述'])('rejects reserved field name %s', async name => {
  render(<EntryFieldsEditor workspaceRoot="test" fields={[]} onFieldsChange={() => {}} />);
  await waitFor(() => expect((screen.getByRole('button', { name: '属性管理' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '属性管理' }));
  expect(screen.getByText(/属性定义目前仅保存在本机资料库/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('属性名称'), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: '添加属性定义' }));
  expect(screen.getByRole('alert').textContent).toContain('系统保留');
  expect(saveFieldDefinitions).not.toHaveBeenCalled();
});
it('retains legacy select values and offers configured choices without editing automatically', async () => {
  const changed = vi.fn();
  render(<EntryFieldsEditor workspaceRoot="test" fields={[{ id: 'old', key: '类型', value: '旧值' }]} onFieldsChange={changed} />);
  expect((await screen.findByRole('combobox', { name: '类型的值' })).textContent).toContain('旧值');
  expect(changed).not.toHaveBeenCalled();
});
it('selects a configured property with an empty value without modifying existing fields', async () => {
  const changed = vi.fn();
  render(<EntryFieldsEditor workspaceRoot="test" fields={[{ id: 'old', key: '自定义', value: '保留' }]} onFieldsChange={changed} />);
  const select = await screen.findByRole('combobox', { name: '选择已定义属性' });
  fireEvent.keyDown(select, { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name: '类型' }));
  await waitFor(() => expect(changed).toHaveBeenCalledWith(expect.arrayContaining([
    expect.objectContaining({ key: '自定义', value: '保留' }), expect.objectContaining({ key: '类型', value: '' }),
  ])));
});
it('does not replace an incompatible older multi-select value', async () => {
  const changed = vi.fn();
  render(<EntryFieldsEditor workspaceRoot="test" fields={[{ id: 'old', key: '收录', value: '旧数据' }]} onFieldsChange={changed} />);
  await waitFor(() => expect((screen.getByPlaceholderText('属性值') as HTMLInputElement).value).toBe('旧数据'));
  expect(changed).not.toHaveBeenCalled();
});
it('shows an incompatible legacy date as text instead of losing it', async () => {
  const changed = vi.fn();
  render(<EntryFieldsEditor workspaceRoot="test" fields={[{ id: 'old', key: '日期', value: '2020-02-30' }]} onFieldsChange={changed} />);
  await waitFor(() => expect((screen.getByPlaceholderText('属性值') as HTMLInputElement).type).toBe('text'));
  expect((screen.getByPlaceholderText('属性值') as HTMLInputElement).value).toBe('2020-02-30');
  expect(changed).not.toHaveBeenCalled();
});

it('retains the draft and refuses saving to a different workspace', async () => {
  const props = { fields: [], onFieldsChange: () => {} };
  const view = render(<EntryFieldsEditor workspaceRoot="A" {...props} />);
  await waitFor(() => expect((screen.getByRole('button', {name:'属性管理'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', {name:'属性管理'}));
  fireEvent.change(screen.getByLabelText('属性名称'), {target:{value:'仅属于 A'}});
  fireEvent.click(screen.getByRole('button', {name:'添加属性定义'}));
  view.rerender(<EntryFieldsEditor workspaceRoot="B" {...props} />);
  expect((screen.getByRole('button',{name:'保存属性定义'}) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/资料库已切换/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', {name:'取消'}));
  expect(screen.getByText(/有未保存的属性配置/)).toBeTruthy();
  expect(saveFieldDefinitions).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'放弃修改并关闭'}));
});
it('clears the value when the last multi-select option is unchecked', async () => {
  const changed = vi.fn();
  render(<EntryFieldsEditor workspaceRoot="test" fields={[{id:'one',key:'收录',value:'["SCI"]'}]} onFieldsChange={changed} />);
  fireEvent.click(await screen.findByRole('checkbox',{name:'SCI'}));
  expect(changed).toHaveBeenCalledWith([expect.objectContaining({key:'收录',value:''})]);
});

it('ignores out-of-order definition reads for the same workspace', async () => {
  const pending: Array<(items: any[]) => void> = [];
  vi.mocked(readFieldDefinitions).mockImplementation(() => new Promise(resolve => pending.push(resolve)));
  function View() { const state = useFieldDefinitions('test'); return <div>{state.definitions.map(item => item.name).join(',')}</div>; }
  const view = render(<View />);
  await waitFor(() => expect(pending).toHaveLength(1));
  window.dispatchEvent(new CustomEvent('neuink-field-definitions-changed', {detail:{root:'test'}}));
  await waitFor(() => expect(pending).toHaveLength(2));
  pending[1]([{name:'最新',kind:'text',options:[],hidden:false}]);
  await screen.findByText('最新');
  pending[0]([{name:'过时',kind:'text',options:[],hidden:false}]);
  await waitFor(() => expect(view.container.textContent).toBe('最新'));
  vi.mocked(readFieldDefinitions).mockReset();
});

it('protects a partially entered option when closing the dialog', async () => {
  vi.mocked(readFieldDefinitions).mockResolvedValueOnce([{name:'级别',kind:'select',options:['A'],hidden:false}]);
  render(<EntryFieldsEditor workspaceRoot="test" fields={[]} onFieldsChange={() => {}} />);
  await waitFor(() => expect((screen.getByRole('button',{name:'属性管理'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:'属性管理'}));
  fireEvent.change(screen.getByLabelText('新选项'), {target:{value:'B'}});
  fireEvent.click(screen.getByRole('button',{name:'取消'}));
  expect(screen.getByText(/有未保存的属性配置/)).toBeTruthy();
});

it('registers unsaved property definitions with the entry close guard', async () => {
  vi.mocked(readFieldDefinitions).mockResolvedValueOnce([]);
  render(<EntryFieldsEditor workspaceRoot="test" scopeKey="entry-overview:guarded" ownerId="guarded" fields={[]} onFieldsChange={() => {}} />);
  await waitFor(() => expect((screen.getByRole('button',{name:'属性管理'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:'属性管理'}));
  fireEvent.change(screen.getByLabelText('属性名称'), {target:{value:'未完成'}});
  await waitFor(() => expect(hasUnsavedSegmentEditors('entry-overview:guarded')).toBe(true));
  await act(async () => { expect(await saveSegmentEditorsBeforeClose('entry-overview:guarded')).toBe(false); });
  expect(screen.getByText(/请先添加或清除/)).toBeTruthy();
});

it('uses year, month and day inputs according to date precision', async () => {
  vi.mocked(readFieldDefinitions).mockResolvedValueOnce([
    { name: '年份', kind: 'date', date_precision: 'year', options: [], hidden: false },
    { name: '月份', kind: 'date', date_precision: 'month', options: [], hidden: false },
    { name: '日期', kind: 'date', date_precision: 'day', options: [], hidden: false },
  ]);
  render(<EntryDefinedFieldValues workspaceRoot="dates" fields={[]} onFieldsChange={() => {}} />);
  expect((await screen.findByLabelText('年份的值') as HTMLInputElement).placeholder).toContain('年');
  expect((screen.getByLabelText('月份的值') as HTMLInputElement).type).toBe('month');
  expect((screen.getByLabelText('日期的值') as HTMLInputElement).type).toBe('date');
});
