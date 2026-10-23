import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ApprovalDecisionForm, ApprovalLevels, ApprovalStatusPill } from './ApprovalParts';

describe('ApprovalDecisionForm', () => {
  it('approves with or without a comment', () => {
    const onAnswer = vi.fn();
    render(<ApprovalDecisionForm onAnswer={onAnswer} pending={null} error={null} />);
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));
    expect(onAnswer).toHaveBeenCalledWith('approved', '');
  });

  it('will not reject without saying why', () => {
    const onAnswer = vi.fn();
    render(<ApprovalDecisionForm onAnswer={onAnswer} pending={null} error={null} />);
    fireEvent.click(screen.getByRole('button', { name: /reject/i }));
    expect(onAnswer).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Say why you reject it.');

    fireEvent.change(screen.getByLabelText(/comment/i), { target: { value: '  Over budget  ' } });
    fireEvent.click(screen.getByRole('button', { name: /reject/i }));
    expect(onAnswer).toHaveBeenCalledWith('rejected', 'Over budget');
  });

  it('locks both buttons while an answer is being sent, and shows a refusal', () => {
    render(<ApprovalDecisionForm onAnswer={vi.fn()} pending="approved" error={new Error('Already rejected.')} />);
    expect(screen.getByRole('button', { name: /reject/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /approve/i })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Already rejected.');
  });
});

describe('ApprovalLevels', () => {
  it('shows each level, who answered what, and who stood in', () => {
    render(
      <ApprovalLevels
        steps={[
          {
            level: 1,
            status: 'approved',
            approvers: [{ name: 'Ann Lee', decision: 'approved', comment: 'Fine', at: '2026-10-22T10:00:00Z', answeredBy: 'Bo Kim' }],
          },
          { level: 2, status: 'in_progress', approvers: [{ name: 'Cy Ode', decision: null, comment: '', at: '', answeredBy: '' }] },
        ]}
      />,
    );
    expect(screen.getByText(/Level 1 · Approved/)).toBeInTheDocument();
    expect(screen.getByText(/Level 2 · Waiting for answers/)).toBeInTheDocument();
    expect(screen.getByText('Answered by Bo Kim, standing in')).toBeInTheDocument();
    expect(screen.getByText('“Fine”')).toBeInTheDocument();
    expect(screen.getByText(/no answer yet/)).toBeInTheDocument();
  });
});

describe('ApprovalStatusPill', () => {
  it('says the status in words', () => {
    for (const [status, text] of [
      ['pending', 'Awaiting approval'],
      ['approved', 'Approved'],
      ['rejected', 'Rejected'],
    ] as const) {
      const { unmount } = render(<ApprovalStatusPill status={status} />);
      expect(screen.getByText(text)).toBeInTheDocument();
      unmount();
    }
  });
});
