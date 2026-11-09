import { expect, type Locator, type Page } from '@playwright/test';
import { BasePage } from './base.page.js';

export class LoginPage extends BasePage {
  readonly email: Locator;
  readonly password: Locator;
  readonly submit: Locator;
  readonly errorSummary: Locator;

  constructor(page: Page) {
    super(page);
    this.email = page.locator('#Email');
    this.password = page.locator('#Password');
    this.submit = page.getByRole('button', { name: 'Log in' });
    this.errorSummary = page.locator('.validation-summary-errors');
  }

  async goto(): Promise<void> {
    await this.open('/login');
  }

  async login(email: string, password: string): Promise<void> {
    await this.email.fill(email);
    await this.password.fill(password);
    await this.submit.click();
  }

  async expectError(text: string): Promise<void> {
    await expect(this.errorSummary).toContainText(text);
  }
}
