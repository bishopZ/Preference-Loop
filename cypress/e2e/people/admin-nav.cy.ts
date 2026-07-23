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

describe('Auth-aware header nav (F-10, AC-10)', () => {
  it('shows no admin links on public pages when unauthenticated', () => {
    cy.clearCookies();
    cy.visit('/');
    cy.get('header').should('be.visible');
    cy.get('header').contains('People').should('not.exist');
    cy.get('header').contains('a', 'Login').should('be.visible');
    cy.get('header').contains('/admin').should('not.exist');
  });

  it('blocks admin pages when unauthenticated (no admin nav reachable)', () => {
    cy.clearCookies();
    cy.visit('/admin/people');
    cy.location('pathname').should('eq', '/login');
  });

  it('shows People and Logout links on admin pages when authenticated', () => {
    withCsrfToken((csrfToken) => {
      login(csrfToken);
      cy.visit('/admin/people');
      cy.get('header').contains('a', 'People').should('be.visible');
      cy.get('header').contains('a', 'Logout').should('be.visible');
      cy.get('header').contains('a', 'Product').should('not.exist');
    });
  });
});
