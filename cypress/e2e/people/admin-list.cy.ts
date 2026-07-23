const DEFAULT_USERNAME = 'test';
const DEFAULT_PASSWORD = 'test';

const getLoginCredentials = () => {
  const username = Cypress.env('TEST_USERNAME');
  const password = Cypress.env('TEST_PASSWORD');

  return {
    username: typeof username === 'string' ? username : DEFAULT_USERNAME,
    password: typeof password === 'string' ? password : DEFAULT_PASSWORD,
  };
};

interface PersonRow {
  id: string;
  name: string;
}

/** Visits any page to receive the double-submit CSRF cookie, then yields it. */
const withCsrfToken = (fn: (csrfToken: string) => void) => {
  cy.request('/');
  cy.getCookie('csrf-token').then((cookie) => {
    expect(cookie, 'csrf-token cookie').to.not.be.null;
    fn(cookie?.value ?? '');
  });
};

const login = (csrfToken: string) => {
  const { username, password } = getLoginCredentials();
  cy.request({
    method: 'POST',
    url: '/api/session',
    headers: { 'x-csrf-token': csrfToken },
    body: { username, password },
  });
};

const seedPerson = (
  csrfToken: string,
  body: Record<string, string>,
  fn: (person: PersonRow) => void
) => {
  cy.request<PersonRow>({
    method: 'POST',
    url: '/api/admin/people',
    headers: { 'x-csrf-token': csrfToken },
    body,
  }).then((response) => { fn(response.body); });
};

describe('People admin list (F-05, F-13)', () => {
  it('redirects unauthenticated visitors to login', () => {
    cy.clearCookie('token');
    cy.visit('/admin/people');
    cy.location('pathname').should('eq', '/login');
  });

  it('renders rows, filters by eligibility, and deletes with confirmation', () => {
    const stamp = String(Date.now());
    const eligibleName = `Cypress Eligible ${stamp}`;
    const ineligibleName = `Cypress Ineligible ${stamp}`;

    withCsrfToken((csrfToken) => {
      login(csrfToken);
      seedPerson(
        csrfToken,
        { name: eligibleName, wikipedia_article_title: `Cypress Title ${stamp}` },
        () => {
          seedPerson(csrfToken, { name: ineligibleName }, (ineligible) => {
            cy.visit('/admin/people');
            cy.get('[data-testid="people-table"]').should('be.visible');
            cy.contains('[data-testid="person-row-name"]', eligibleName).should('exist');
            cy.contains('[data-testid="person-row-name"]', ineligibleName).should('exist');

            // F-13: eligibility filter
            cy.get('[data-testid="filter-eligible"]').click();
            cy.contains('[data-testid="person-row-name"]', eligibleName).should('exist');
            cy.contains('[data-testid="person-row-name"]', ineligibleName).should('not.exist');

            cy.get('[data-testid="filter-ineligible"]').click();
            cy.contains('[data-testid="person-row-name"]', eligibleName).should('not.exist');
            cy.contains('[data-testid="person-row-name"]', ineligibleName).should('exist');

            cy.get('[data-testid="filter-all"]').click();

            // Delete flow with inline confirmation (AC-03 endpoint)
            cy.contains('[data-testid="person-row"]', ineligibleName)
              .find('[data-testid="person-delete"]').click();
            cy.contains('[data-testid="person-row"]', ineligibleName)
              .find('[data-testid="person-delete-confirm"]').click();
            cy.contains('[data-testid="person-row-name"]', ineligibleName).should('not.exist');

            // Row removed server-side, not only client-side
            cy.request<{ people: PersonRow[] }>('/api/admin/people').then((response) => {
              const stillThere = response.body.people.some((row) => row.id === ineligible.id);
              expect(stillThere, 'deleted person absent from admin list API').to.eq(false);
            });
          });
        }
      );
    });
  });
});
