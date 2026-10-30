import { beforeAll, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { configure, renderWithProviders, screen, within } from '@/test/render';
import { ArticleFeedback } from '../components/ArticleFeedback';
import { htmlToText } from '../lib/labels';
import { KnowledgeArticlePage } from './KnowledgeArticlePage';
import { KnowledgeListPage } from './KnowledgeListPage';

beforeAll(() => configure({ asyncUtilTimeout: 10_000 }));

const articleAt = (route: string) =>
  renderWithProviders(
    <Routes>
      <Route path="/knowledge/:kind/:id" element={<KnowledgeArticlePage />} />
    </Routes>,
    { route },
  );

describe('KnowledgeListPage', () => {
  it('lists articles with their state, and filters to those due for review', async () => {
    const user = userEvent.setup();
    renderWithProviders(<KnowledgeListPage />, { route: '/knowledge' });
    expect(await screen.findByRole('link', { name: 'Map a network printer' })).toHaveAttribute('href', '/knowledge/faq/3');
    expect(screen.getByText('80%')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /Review due/ }));
    expect(await screen.findByRole('link', { name: 'How do I connect to the VPN?' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Map a network printer' })).not.toBeInTheDocument();
  });
});

describe('KnowledgeArticlePage', () => {
  it('moves a draft through review to published', async () => {
    const user = userEvent.setup();
    articleAt('/knowledge/faq/3');
    await user.click(await screen.findByRole('button', { name: 'Submit for review' }));

    const sendBack = await screen.findByRole('button', { name: 'Send back' });
    expect(sendBack).toBeDisabled();
    await user.type(screen.getByLabelText(/Comment/), 'Add the printer name format');
    await user.click(sendBack);
    expect(await screen.findByRole('button', { name: 'Submit for review' })).toBeInTheDocument();
    expect(screen.getByText('Add the printer name format')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Submit for review' }));
    await user.click(await screen.findByRole('button', { name: 'Approve and publish' }));
    expect(await screen.findByText(/Next review 2027-04-28/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Was this helpful?' })).toBeInTheDocument();
  });

  it('shows the answer as text and the readers’ feedback for the author', async () => {
    articleAt('/knowledge/faq/1');
    expect(await screen.findByText('Open My profile, then Change password.')).toBeInTheDocument();
    expect(screen.getByText(/80% found it helpful/)).toBeInTheDocument();
    const feedback = screen.getByRole('list', { name: 'Feedback' });
    expect(within(feedback).getByText('The screenshot is out of date.')).toBeInTheDocument();
  });
});

describe('ArticleFeedback', () => {
  it('sends the vote, then the comment', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<ArticleFeedback onSubmit={onSubmit} />);
    await user.click(screen.getByRole('button', { name: 'No' }));
    expect(onSubmit).toHaveBeenLastCalledWith({ helpful: false, comment: '' });
    await user.type(screen.getByLabelText(/What was missing/), 'No steps for Mac');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSubmit).toHaveBeenLastCalledWith({ helpful: false, comment: 'No steps for Mac' });
    expect(await screen.findByText(/we’ll use it to improve/)).toBeInTheDocument();
  });

  it('shows the error when the vote cannot be sent', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ArticleFeedback onSubmit={() => Promise.reject(new Error('That article is not published.'))} />);
    await user.click(screen.getByRole('button', { name: 'Yes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That article is not published.');
  });
});

describe('htmlToText', () => {
  it('keeps paragraphs and list items, drops tags', () => {
    expect(htmlToText('<p>One &amp; two</p><ul><li>a</li><li>b</li></ul>')).toBe('One & two\n• a\n• b');
  });
});
