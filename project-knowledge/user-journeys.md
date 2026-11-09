# User Journeys

## UJ-01: Guest searches and adds a product to the cart
1. Open the home page.
2. Type "laptop" in the header search box and click Search.
3. Verify "14.1-inch Laptop" appears in the results.
4. Click "Add to cart" on the product tile.
5. Verify the notification "The product has been added to your shopping cart".
6. Verify the header shows "Shopping cart (1)".
7. Open the cart and verify the product line is listed.

## UJ-02: Customer login with invalid credentials
1. Click "Log in" in the header.
2. Enter an unknown email and any password.
3. Click "Log in".
4. Verify the error "Login was unsuccessful. Please correct the errors and try again."

## UJ-03: Browse a category
1. Click "Books" in the top menu.
2. Verify the category page title "Books" and a list of products.
3. Sort by "Price: Low to High" and verify the order of prices.

## UJ-04: Guest checkout up to payment (no order confirmation)
1. Add "14.1-inch Laptop" to the cart.
2. Open the cart, accept the terms of service and click Checkout.
3. Choose "Checkout as Guest".
4. Fill the billing address with synthetic data from test-data/demowebshop.json.
5. Continue to the shipping method step and verify it is shown.
6. Stop. Do not confirm the order.
