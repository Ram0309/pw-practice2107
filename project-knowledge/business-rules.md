# Business Rules

Rules use the format `- **BR-<AREA>-<NN>**: rule`. The Requirement and Test Design
agents cite these ids. Rules marked (observed) were verified on the live site.

## Search
- **BR-SEARCH-01**: A search term must be at least 3 characters; a shorter term shows "Search term minimum length is 3 characters". (observed)
- **BR-SEARCH-02**: A search with no matching products shows "No products were found that matched your criteria." (observed)
- **BR-SEARCH-03**: Submitting an empty search box from the header shows a browser alert "Please enter some search keyword". (observed)
- **BR-SEARCH-04**: Search matches product names case-insensitively; searching "laptop" returns "14.1-inch Laptop". (observed)

## Cart
- **BR-CART-01**: Adding a simple product from a listing adds quantity 1 and shows "The product has been added to your shopping cart". (observed)
- **BR-CART-02**: The header cart counter shows the total quantity in the cart as "(N)". (observed)
- **BR-CART-03**: A new browser session starts with an empty cart "(0)". (observed)
- **BR-CART-04**: Products that require options (e.g. "Build your own computer") open the product page instead of adding directly.
- **BR-CART-05**: Cart line total equals unit price multiplied by quantity; subtotal is the sum of line totals.
- **BR-CART-06**: Quantity must be a positive whole number.

## Login
- **BR-LOGIN-01**: Login requires a registered email and matching password.
- **BR-LOGIN-02**: An unknown email shows "Login was unsuccessful. Please correct the errors and try again." and "No customer account found". (observed)
- **BR-LOGIN-03**: Email must be a valid email format; invalid format shows "Please enter a valid email address." next to the field and the form is not submitted. (observed)
- **BR-LOGIN-04**: After a successful login the header shows the customer email and a "Log out" link.

## Checkout
- **BR-CHECKOUT-01**: Checkout requires accepting the terms of service.
- **BR-CHECKOUT-02**: Billing address requires first name, last name, email, country, city, address 1, zip code and phone number.
- **BR-CHECKOUT-03**: Automated runs must never confirm an order on the shared demo environment.

## General
- **BR-GEN-01**: Tests must use synthetic data only. No real names, addresses or payment details.
- **BR-GEN-02**: Expected results must never be changed just to make a failing test pass.
- **BR-GEN-03**: Unknown rules are recorded as assumptions and confirmed with the product owner.
