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
  imdb_name_id: string | null;
  slug: string | null;
  wikipedia_article_title: string | null;
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

const fetchPeople = (fn: (people: PersonRow[]) => void) => {
  cy.request<{ people: PersonRow[] }>('/api/admin/people').then((response) => {
    fn(response.body.people);
  });
};

describe('Admin person form (F-04, F-14)', () => {
  it('redirects unauthenticated visitors to login', () => {
    cy.clearCookies();
    cy.visit('/admin/people/new');
    cy.location('pathname').should('eq', '/login');
  });

  it('shows inline validation errors and does not submit', () => {
    withCsrfToken((csrfToken) => {
      login(csrfToken);
      cy.visit('/admin/people/new');
      cy.get('[data-testid="person-wikiUrl-input"]').type('not-a-url');
      cy.get('[data-testid="person-form-submit"]').click();
      cy.get('[data-testid="person-name-error"]').should('be.visible');
      cy.get('[data-testid="person-wikiUrl-error"]').should('be.visible');
      cy.location('pathname').should('eq', '/admin/people/new');
    });
  });

  it('creates a person and redirects to the admin list', () => {
    const name = `Cypress Form Create ${String(Date.now())}`;

    withCsrfToken((csrfToken) => {
      login(csrfToken);
      cy.visit('/admin/people/new');
      cy.get('[data-testid="person-name-input"]').type(name);
      cy.get('[data-testid="person-wikiTitle-input"]').type(`${name} (title)`);
      cy.get('[data-testid="person-form-submit"]').click();
      cy.location('pathname').should('eq', '/admin/people');
      fetchPeople((people) => {
        const created = people.find((row) => row.name === name);
        expect(created, 'created person in admin list').to.not.be.undefined;
      });
    });
  });

  it('edits a person with pre-populated fields including IMDb ID and slug', () => {
    const name = `Cypress Form Edit ${String(Date.now())}`;
    const updatedName = `${name} Updated`;
    const imdbNameId = `nm${String(Date.now()).slice(-7)}`;
    const slug = `cypress-form-edit-${String(Date.now())}`;
    const updatedImdb = `${imdbNameId}x`;
    const updatedSlug = `${slug}-updated`;

    withCsrfToken((csrfToken) => {
      login(csrfToken);
      cy.request<PersonRow>({
        method: 'POST',
        url: '/api/admin/people',
        headers: { 'x-csrf-token': csrfToken },
        body: { name, imdb_name_id: imdbNameId, slug },
      }).then((created) => {
        cy.visit(`/admin/people/${created.body.id}/edit`);
        cy.get('[data-testid="person-name-input"]').should('have.value', name);
        cy.get('[data-testid="person-imdbNameId-input"]').should('have.value', imdbNameId);
        cy.get('[data-testid="person-slug-input"]').should('have.value', slug);
        cy.get('[data-testid="person-name-input"]').clear();
        cy.get('[data-testid="person-name-input"]').type(updatedName);
        cy.get('[data-testid="person-imdbNameId-input"]').clear();
        cy.get('[data-testid="person-imdbNameId-input"]').type(updatedImdb);
        cy.get('[data-testid="person-slug-input"]').clear();
        cy.get('[data-testid="person-slug-input"]').type(updatedSlug);
        cy.get('[data-testid="person-form-submit"]').click();
        cy.location('pathname').should('eq', '/admin/people');
        fetchPeople((people) => {
          const updated = people.find((row) => row.id === created.body.id);
          expect(updated?.name, 'updated name in admin list').to.eq(updatedName);
          expect(updated?.imdb_name_id, 'updated imdb_name_id').to.eq(updatedImdb);
          expect(updated?.slug, 'updated slug').to.eq(updatedSlug);
        });
      });
    });
  });
});
