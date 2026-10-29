import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { IncidentRecordRedirect } from './IncidentRecordRedirect';

function Where() {
  return <p>{useLocation().pathname}</p>;
}

describe('IncidentRecordRedirect', () => {
  it('opens an incident on the full record screen', () => {
    render(
      <MemoryRouter initialEntries={['/incidents/42']}>
        <Routes>
          <Route path="/incidents/:id" element={<IncidentRecordRedirect />} />
          <Route path="/records/:className/:id" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('/records/Incident/42')).toBeTruthy();
  });
});
