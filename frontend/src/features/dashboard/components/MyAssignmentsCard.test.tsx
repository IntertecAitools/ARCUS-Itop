import { describe, expect, it } from 'vitest';
import { Route, Routes, useParams } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, screen } from '@/test/render';
import { emptyOverview, seededOverview } from '@/mocks/fixtures/dashboard';
import { MyAssignmentsCard } from './MyAssignmentsCard';

function Opened() {
  const { cls, id } = useParams();
  return <p>Opened {cls} {id}</p>;
}

function renderCard(data = seededOverview.myAssignments) {
  renderWithProviders(
    <Routes>
      <Route path="/" element={<MyAssignmentsCard data={data} isLoading={false} />} />
      <Route path="/records/:cls/:id" element={<Opened />} />
    </Routes>,
  );
}

describe('MyAssignmentsCard changes tab', () => {
  it("lists the viewer's changes with iTop's status label and opens the record", async () => {
    renderCard();
    await userEvent.click(screen.getByRole('tab', { name: /Changes/ }));
    expect(screen.getByText('Patch the VPN concentrators')).toBeInTheDocument();
    // iTop's own words for the status, not a ticket status.
    expect(screen.getByText('Planned and scheduled')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View all/i })).toHaveAttribute(
      'href',
      '/records/Change?view=MyChanges',
    );
    await userEvent.click(screen.getByText('C-000031'));
    expect(screen.getByText('Opened NormalChange 31')).toBeInTheDocument();
  });

  it('shows the empty state when nothing is assigned', async () => {
    renderCard(emptyOverview.myAssignments);
    await userEvent.click(screen.getByRole('tab', { name: /Changes/ }));
    expect(screen.getByText('Nothing assigned to you')).toBeInTheDocument();
  });
});
