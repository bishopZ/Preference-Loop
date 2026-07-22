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

const MISSING_UUID = '00000000-0000-0000-0000-000000000000';

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

describe('Admin people CRUD API', () => {
  describe('unauthenticated', () => {
    beforeEach(() => {
      // Keep the CSRF cookie; clear only the auth token so the
      // request reaches the auth middleware (401), not CSRF (403).
      cy.clearCookie('token');
    });

    it('returns 401 for create', () => {
      withCsrfToken((csrfToken) => {
        cy.request({
          method: 'POST',
          url: '/api/admin/people',
          headers: { 'x-csrf-token': csrfToken },
          body: { name: 'Unauthorized Person' },
          failOnStatusCode: false,
        }).its('status').should('eq', 401);
      });
    });

    it('returns 401 for update', () => {
      withCsrfToken((csrfToken) => {
        cy.request({
          method: 'PUT',
          url: `/api/admin/people/${MISSING_UUID}`,
          headers: { 'x-csrf-token': csrfToken },
          body: { name: 'Unauthorized Person' },
          failOnStatusCode: false,
        }).its('status').should('eq', 401);
      });
    });

    it('returns 401 for delete', () => {
      withCsrfToken((csrfToken) => {
        cy.request({
          method: 'DELETE',
          url: `/api/admin/people/${MISSING_UUID}`,
          headers: { 'x-csrf-token': csrfToken },
          failOnStatusCode: false,
        }).its('status').should('eq', 401);
      });
    });
  });

  describe('authenticated', () => {
    it('creates, updates, and deletes a person end-to-end', () => {
      const name = `Cypress CRUD ${String(Date.now())}`;
      const updatedName = `${name} Updated`;

      withCsrfToken((csrfToken) => {
        login(csrfToken);

        cy.request({
          method: 'POST',
          url: '/api/admin/people',
          headers: { 'x-csrf-token': csrfToken },
          body: { name },
        }).then((createResponse) => {
          expect(createResponse.status).to.eq(201);
          expect(createResponse.body).to.have.property('id');
          expect(createResponse.body.name).to.eq(name);

          const personId = (createResponse.body as PersonRow).id;

          cy.request({
            method: 'PUT',
            url: `/api/admin/people/${personId}`,
            headers: { 'x-csrf-token': csrfToken },
            body: { name: updatedName },
          }).then((updateResponse) => {
            expect(updateResponse.status).to.eq(200);
            expect(updateResponse.body.name).to.eq(updatedName);
          });

          cy.request({
            method: 'DELETE',
            url: `/api/admin/people/${personId}`,
            headers: { 'x-csrf-token': csrfToken },
          }).then((deleteResponse) => {
            expect(deleteResponse.status).to.eq(204);
          });

          cy.request('/api/admin/people').then((listResponse) => {
            const people = (listResponse.body as { people: PersonRow[] }).people;
            const ids = people.map((person) => person.id);
            expect(ids).to.not.include(personId);
          });
        });
      });
    });

    it('rejects create without a name', () => {
      withCsrfToken((csrfToken) => {
        login(csrfToken);
        cy.request({
          method: 'POST',
          url: '/api/admin/people',
          headers: { 'x-csrf-token': csrfToken },
          body: {},
          failOnStatusCode: false,
        }).its('status').should('eq', 400);
      });
    });

    it('returns 404 for update and delete of a missing person', () => {
      withCsrfToken((csrfToken) => {
        login(csrfToken);
        cy.request({
          method: 'PUT',
          url: `/api/admin/people/${MISSING_UUID}`,
          headers: { 'x-csrf-token': csrfToken },
          body: { name: 'Ghost' },
          failOnStatusCode: false,
        }).its('status').should('eq', 404);

        cy.request({
          method: 'DELETE',
          url: `/api/admin/people/${MISSING_UUID}`,
          headers: { 'x-csrf-token': csrfToken },
          failOnStatusCode: false,
        }).its('status').should('eq', 404);
      });
    });
  });
});
