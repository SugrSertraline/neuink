// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ResearchPanel, ResearchSetup } from './ResearchPanel';
import type { ResearchModel } from './useResearchTasks';
vi.mock('../components/ChatMessage', () => ({ ChatMessage: ({message}:any) => <div>{message.role}: {message.content}</div> }));
vi.mock('./ResearchReport', () => ({ ResearchReport: () => <div>Report actions</div> }));
afterEach(cleanup);
const state = (status:any) => ({status,thread:[],tasks:[],command:vi.fn(),error:null,busy:false}) as unknown as ResearchModel;
it('first use navigates to settings without starting installation', () => {
  const model = state({ready:false,active:null}), openSettings = vi.fn();
  render(<ResearchSetup model={model} onOpenSettings={openSettings} />);
  fireEvent.click(screen.getByRole('button',{name:'前往设置安装'}));
  expect(openSettings).toHaveBeenCalledOnce(); expect(model.command).not.toHaveBeenCalled();
  expect(screen.queryByText(/Python|PyPI|轮次/)).toBeNull();
});
it('installation in chat links to settings and never starts or cancels work', () => {
  const model = state({ready:false,active:{id:'install',installation:true,stage:'正在安装研究组件',progress:42}}), openSettings = vi.fn();
  render(<ResearchSetup model={model} onOpenSettings={openSettings} />);
  expect(screen.getByRole('status').textContent).toContain('42%');
  fireEvent.click(screen.getByRole('button',{name:'查看安装进度'}));
  expect(openSettings).toHaveBeenCalledOnce(); expect(model.command).not.toHaveBeenCalled();
});
it('renders saved questions and answers directly in chat and restores previous turns', () => {
  const task = {id:'one',query:'Previous question',report:'Previous answer',created_at:'2026-10-24',status:'completed',stage:'研究完成'};
  const model = {...state({ready:true,active:null}), task, selected:'two',thread:[task,{...task,id:'two',query:'Follow up',report:'Follow-up answer'}]} as unknown as ResearchModel;
  render(<ResearchPanel root="root" model={model} entries={[]} onApply={async p=>p} onOpenSource={()=>{}} scrollRef={{current:null}} contentRef={{current:null}} endRef={{current:null}} onScroll={()=>{}} historyOpen={false} onCloseHistory={()=>{}} />);
  expect(screen.getByText('assistant: Previous answer')).toBeTruthy(); expect(screen.getByText('assistant: Follow-up answer')).toBeTruthy();
  expect(screen.queryByRole('combobox')).toBeNull(); expect(screen.queryByRole('textbox')).toBeNull();
});
it('failed initial status check offers a retry instead of an endless loading message', () => {
  const model = {...state(null), error:'读取组件失败', refresh:vi.fn()};
  render(<ResearchSetup model={model} onOpenSettings={() => {}} />);
  expect(screen.getByRole('alert').textContent).toContain('读取组件失败');
  fireEvent.click(screen.getByRole('button',{name:'重新检查'})); expect(model.refresh).toHaveBeenCalledOnce();
  expect(screen.queryByRole('status')).toBeNull();
});
