import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudySidebar } from './StudySidebar';

function SidebarHarness() {
  const [open, setOpen] = useState(false);

  return (
    <MemoryRouter>
      <button type="button" onClick={() => setOpen(true)}>打开导航</button>
      <StudySidebar
        active="chat"
        open={open}
        username="小林"
        onClose={() => setOpen(false)}
        onStartNew={vi.fn()}
      />
    </MemoryRouter>
  );
}

describe('StudySidebar', () => {
  afterEach(cleanup);

  it('moves focus inside on open and restores the trigger after Escape', async () => {
    render(<SidebarHarness />);
    const trigger = screen.getByRole('button', { name: '打开导航' });

    trigger.focus();
    fireEvent.click(trigger);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '关闭导航' })).toHaveFocus();
    });
    const brand = screen.getByRole('link', { name: '启思 AI 学习空间' });
    brand.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('link', { name: '学习历史' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(brand).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('complementary', { name: '学习侧栏' })).toHaveAttribute(
      'data-open',
      'false',
    );
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
