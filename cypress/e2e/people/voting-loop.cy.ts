/**
 * Public voting loop at `/` (Task 6). Uses cy.intercept so the specs run
 * without a seeded database or login — the loop is a public surface.
 */

const RENDER_TIMEOUT_MS = 3000;

interface PersonFixture {
  id: string;
  name: string;
  imdb_name_id: string | null;
  slug: string | null;
  wikipedia_article_title: string | null;
  wikipedia_page_url: string | null;
  wikipedia_image_url: string | null;
  shown_count: number;
  trial_count: number;
  positive_count: number;
  last_updated: string;
}

const makePerson = (overrides: Partial<PersonFixture> = {}): PersonFixture => ({
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Ada Lovelace',
  imdb_name_id: null,
  slug: null,
  wikipedia_article_title: 'Ada_Lovelace',
  wikipedia_page_url: 'https://en.wikipedia.org/wiki/Ada_Lovelace',
  wikipedia_image_url: null,
  shown_count: 0,
  trial_count: 0,
  positive_count: 0,
  last_updated: new Date().toISOString(),
  ...overrides,
});

const signalReply = { id: '11111111-1111-1111-1111-111111111111', shown_count: 1, trial_count: 0, positive_count: 0 };

describe('Voting loop at /', () => {
  it('renders a person card at / without login within 3s (AC-05)', () => {
    cy.intercept('GET', '/api/people/random', { statusCode: 200, body: makePerson() }).as('random');
    cy.intercept('POST', '/api/people/signal', { statusCode: 200, body: signalReply }).as('signal');

    cy.visit('/');
    cy.wait('@random');
    cy.get('[data-testid="person-name"]', { timeout: RENDER_TIMEOUT_MS })
      .should('be.visible')
      .and('contain.text', 'Ada Lovelace');
  });

  it('fires `shown` on render before any interaction (AC-07)', () => {
    cy.intercept('GET', '/api/people/random', { statusCode: 200, body: makePerson() }).as('random');
    cy.intercept('POST', '/api/people/signal', { statusCode: 200, body: signalReply }).as('signal');

    cy.visit('/');
    cy.wait('@signal').its('request.body').should('deep.include', {
      id: '11111111-1111-1111-1111-111111111111',
      event: 'shown',
    });
  });

  it('upvote fires `positive` and receives 200 (AC-06)', () => {
    cy.intercept('GET', '/api/people/random', { statusCode: 200, body: makePerson() }).as('random');
    cy.intercept('POST', '/api/people/signal', { statusCode: 200, body: signalReply }).as('signal');

    cy.visit('/');
    cy.wait('@signal'); // the initial `shown`
    cy.get('[data-testid="vote-upvote"]').click();

    cy.wait('@signal').then((interception) => {
      expect((interception.request.body as { event: string }).event).to.eq('positive');
      expect(interception.response?.statusCode).to.eq(200);
    });
  });

  it('skip fires `trial` (F-07)', () => {
    cy.intercept('GET', '/api/people/random', { statusCode: 200, body: makePerson() }).as('random');
    cy.intercept('POST', '/api/people/signal', { statusCode: 200, body: signalReply }).as('signal');

    cy.visit('/');
    cy.wait('@signal'); // the initial `shown`
    cy.get('[data-testid="vote-skip"]').click();

    cy.wait('@signal').its('request.body').should('deep.include', { event: 'trial' });
  });

  it('renders the empty state (not an error) when the pool is empty (F-12)', () => {
    cy.intercept('GET', '/api/people/random', { statusCode: 404, body: { error: 'No eligible people yet' } }).as('random');

    cy.visit('/');
    cy.wait('@random');
    cy.get('[data-testid="voting-empty"]').should('be.visible');
    cy.get('[data-testid="voting-card"]').should('not.exist');
    cy.get('[data-testid="voting-error"]').should('not.exist');
  });
});
