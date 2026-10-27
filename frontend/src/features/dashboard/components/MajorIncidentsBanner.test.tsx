import { describe, expect, it } from 'vitest';
import { renderWithProviders, screen } from '@/test/render';
import { MajorIncidentsBanner } from './MajorIncidentsBanner';

describe('MajorIncidentsBanner', () => {
  it('names the open major incidents and links to them', () => {
    renderWithProviders(
      <MajorIncidentsBanner
        items={[
          {
            id: '1',
            ref: 'I-000001',
            summary: 'Email down',
            status: 'open',
            priority: 'critical',
            createdAt: '2026-10-26T09:00:00Z',
          },
        ]}
      />,
    );
    expect(screen.getByRole('alert', { name: 'Major incidents' })).toHaveTextContent('1 major incident is open');
    expect(screen.getByRole('link', { name: 'I-000001' })).toHaveAttribute('href', '/incidents/1');
  });

  it('renders nothing when none are open', () => {
    const { container } = renderWithProviders(<MajorIncidentsBanner items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
