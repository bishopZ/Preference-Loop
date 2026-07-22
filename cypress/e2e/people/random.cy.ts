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
  wikipedia_article_title: string | null;
}

const RANDOM_CALLS = 10;

describe('Random eligible person API', () => {
  it('never returns an ineligible person across repeated calls (AC-08)', () => {
    cy.request('/');
    cy.getCookie('csrf-token').then((cookie) => {
      const csrfToken = cookie?.value ?? '';
      const { username, password } = getLoginCredentials();

      cy.request({
        method: 'POST',
        url: '/api/session',
        headers: { 'x-csrf-token': csrfToken },
        body: { username, password },
      });

      const suffix = String(Date.now());
      const created: string[] = [];

      // Seed one eligible and one ineligible person via the Task 1 API.
      cy.request({
        method: 'POST',
        url: '/api/admin/people',
        headers: { 'x-csrf-token': csrfToken },
        body: {
          name: `Eligible Person ${suffix}`,
          wikipedia_article_title: `Eligible_Person_${suffix}`,
        },
      }).then((response) => {
        created.push((response.body as PersonRow).id);
      });

      cy.request({
        method: 'POST',
        url: '/api/admin/people',
        headers: { 'x-csrf-token': csrfToken },
        body: { name: `Ineligible Person ${suffix}` },
      }).then((response) => {
        const ineligibleId = (response.body as PersonRow).id;
        created.push(ineligibleId);

        for (let call = 0; call < RANDOM_CALLS; call += 1) {
          cy.request('/api/people/random').then((randomResponse) => {
            expect(randomResponse.status).to.eq(200);
            const person = randomResponse.body as PersonRow;
            expect(person.id, 'ineligible person must never be returned').to.not.eq(ineligibleId);
            expect(person.wikipedia_article_title, 'returned person is eligible').to.not.be.null;
          });
        }

        // Cleanup: remove seeded rows.
        cy.then(() => {
          created.forEach((id) => {
            cy.request({
              method: 'DELETE',
              url: `/api/admin/people/${id}`,
              headers: { 'x-csrf-token': csrfToken },
            });
          });
        });
      });
    });
  });
});
