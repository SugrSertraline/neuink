// @vitest-environment jsdom
import { afterEach,expect,it,vi } from 'vitest';
import { cleanup,render,screen,waitFor,act,fireEvent } from '@testing-library/react';
import { DormScene } from './DormScene';
import type { SceneInput } from './sceneState';
const mocked=vi.hoisted(()=>({create:vi.fn(),update:vi.fn(),dispose:vi.fn()}));
vi.mock('./dormRenderer',()=>({createDormScene:mocked.create}));
const input:SceneInput={season:'spring',weather:'sunny',behavior:'idle',sequence:0,away:false,moving:true};
afterEach(()=>{cleanup();vi.resetAllMocks();});
it('updates an existing engine, pauses hidden scene, and disposes once on unmount',async()=>{
  mocked.create.mockReturnValue({update:mocked.update,dispose:mocked.dispose});
  const view=render(<DormScene input={input} name="海豹" onWave={()=>{}}/>);
  await waitFor(()=>expect(mocked.create).toHaveBeenCalledTimes(1));
  view.rerender(<DormScene input={{...input,behavior:'typing',moving:false}} name="海豹" onWave={()=>{}}/>);
  expect(mocked.update).toHaveBeenLastCalledWith(expect.objectContaining({moving:false,behavior:'typing'}));
  expect(mocked.create).toHaveBeenCalledTimes(1);view.unmount();expect(mocked.dispose).toHaveBeenCalledTimes(1);
});
it('releases a failed context and offers retry without changing game data',async()=>{
  mocked.create.mockReturnValue({update:mocked.update,dispose:mocked.dispose});
  render(<DormScene input={input} name="海豹" onWave={()=>{}}/>);
  await waitFor(()=>expect(mocked.create).toHaveBeenCalledTimes(1));
  await act(async()=>mocked.create.mock.calls[0][2]('图形上下文已中断'));
  expect(mocked.dispose).toHaveBeenCalledTimes(1);expect(screen.getByRole('img',{name:'海豹'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'重试手绘场景'}));
  await waitFor(()=>expect(mocked.create).toHaveBeenCalledTimes(2));
});
