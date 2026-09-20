import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api';
import { TeacherPage } from './TeacherPage';
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
afterEach(cleanup);
beforeEach(() => vi.mocked(apiFetch).mockReset());
describe('B06 teacher UI explicit exposure', () => {
 it('never prefetches traces on mount', () => {
  render(<TeacherPage sessionId="session1" initialVersion={3} />); expect(apiFetch).not.toHaveBeenCalled();
 });
 it('requires independent login plus exposure confirmation; does not put credential in trace request', async () => {
  vi.mocked(apiFetch).mockResolvedValueOnce({ authenticated: true }).mockResolvedValueOnce({ task_id: 'task1', version: 4, traces: [], runs: [], limitations: [] });
  render(<TeacherPage sessionId="session1" initialVersion={3} />);
  fireEvent.change(screen.getByLabelText('教师访问凭据'), { target: { value: 'secret'.repeat(8) } });
  fireEvent.click(screen.getByRole('button', { name: '教师登录' }));
  await waitFor(() => expect(screen.getByRole('checkbox')).toBeInTheDocument());
  expect(screen.getByRole('button', { name: '确认曝光并查看' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: '确认曝光并查看' }));
  await waitFor(() => expect(screen.getByText('当前任务：task1')).toBeInTheDocument());
  const [url, init] = vi.mocked(apiFetch).mock.calls[1]!;
  expect(url).toBe('/api/teacher/trace'); expect(init?.method).toBe('POST');
  expect(JSON.parse(String(init?.body))).toMatchObject({ session_id: 'session1', expected_version: 3, confirm_exposure: true });
  expect(String(init?.body)).not.toContain('secret');
 });
});
