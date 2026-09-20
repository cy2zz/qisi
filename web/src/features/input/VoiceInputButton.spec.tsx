import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoiceInputButton } from './VoiceInputButton';

describe('VoiceInputButton', () => {
  afterEach(cleanup);

  it('shows separate long-form and realtime voice buttons without a mode dialog', () => {
    render(<VoiceInputButton onTranscript={vi.fn()} />);

    expect(screen.getByRole('group', { name: '语音输入' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '长语音' })).toHaveAttribute('data-tooltip', '长语音');
    expect(screen.getByRole('button', { name: '实时语音' })).toHaveAttribute('data-tooltip', '实时语音');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('disables both voice modes together with the composer', () => {
    render(<VoiceInputButton disabled onTranscript={vi.fn()} />);

    expect(screen.getByRole('button', { name: '长语音' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '实时语音' })).toBeDisabled();
  });
});
