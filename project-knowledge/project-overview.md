# Project Overview

- Project: Demo Web Shop QA (AI-QA-AGENT-FRAMEWORK)
- Application under test: Tricentis Demo Web Shop
- Base URL: https://demowebshop.tricentis.com
- Type: Amazon-like B2C e-commerce web application (nopCommerce based)
- Environment: Public shared demo environment, provided by Tricentis for test-automation practice

## Scope

- Home page, header and top navigation menu
- Category browsing (Books, Computers, Electronics, Apparel & Shoes, Digital downloads, Jewelry, Gift Cards)
- Product search
- Product details page
- Shopping cart (guest and registered)
- Customer login and registration
- Checkout (guest and registered) up to, but not including, order confirmation in automated runs
- Wishlist and product comparison

## Test objectives

Verify core customer journeys, input validation, cart behaviour, navigation and
the JSON endpoints used by the storefront.

## Roles

- Guest: browse, search, add to cart, guest checkout
- Registered customer: everything a guest can do plus account, order history, wishlist

## Environment constraints

- The environment is shared and public. Other users change data at any time.
- Never assume a fixed product stock level, price history or that the cart is empty
  unless the test starts with a fresh browser context.
- Keep load low: no more than 2 parallel workers, no load or stress testing.
- Do not register large numbers of accounts. Re-use the configured test account.

## Non-goals

- No real payment, shipment or fulfilment
- No production customer data
- No performance or security penetration testing against the public demo
