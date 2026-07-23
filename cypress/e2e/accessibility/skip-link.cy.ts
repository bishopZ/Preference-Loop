describe('Skip link accessibility', () => {
  it('shows the skip link when the user presses Tab', () => {
    // Use a static PageLayout page — `/` is the voting loop with async focusables.
    cy.visit('/about');

    cy.get('body').click('topLeft');
    cy.press(Cypress.Keyboard.Keys.TAB);
    cy.focused()
      .should('have.attr', 'href', '#main-content')
      .and('be.visible');
  });
});
