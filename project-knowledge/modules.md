# Application Modules

Each module below is parsed by the framework (Keywords, Risk, Pages, APIs, Rules lines).
`Rules` is the business-rule id prefix owned by the module (see business-rules.md).
Keep the bullet format when editing.

## Module: Product Search
- Keywords: search, find, keyword, query, results, matching, term, minimum length
- Risk: medium
- Pages: /, /search
- APIs: GET /search
- Rules: BR-SEARCH
Header search box (`#small-searchterms`) with a Search button. Results page lists
product tiles with title, price and an Add to cart button when the product is simple.

## Module: Shopping Cart
- Keywords: cart, basket, add to cart, quantity, remove, update cart, subtotal, shopping cart
- Risk: high
- Pages: /cart
- APIs: POST /addproducttocart/catalog/{productId}/1/{quantity}, POST /addproducttocart/details/{productId}/1
- Rules: BR-CART
Header shows "Shopping cart (N)". Adding a product shows a green notification bar
"The product has been added to your shopping cart".

## Module: Customer Login
- Keywords: login, log in, sign in, password, email, authentication, account, logout, remember me
- Risk: high
- Pages: /login, /logout
- APIs: POST /login
- Rules: BR-LOGIN
Login page has Email, Password, Remember me and a "Log in" button. Returning customer
and new customer (Register) panels are shown side by side.

## Module: Customer Registration
- Keywords: register, registration, sign up, create account, gender, first name, last name, confirm password
- Risk: medium
- Pages: /register
- APIs: POST /register
- Rules: none

## Module: Product Catalog
- Keywords: category, browse, books, computers, electronics, apparel, jewelry, gift cards, digital downloads, sort, filter, grid, list, menu
- Risk: medium
- Pages: /books, /computers, /electronics, /apparel-shoes, /digital-downloads, /jewelry, /gift-cards
- APIs: none
- Rules: none

## Module: Product Details
- Keywords: product page, product details, price, description, review, image, specification
- Risk: medium
- Pages: /{product-slug}
- APIs: POST /addproducttocart/details/{productId}/1
- Rules: BR-CART

## Module: Checkout
- Keywords: checkout, billing, shipping, payment, order, terms of service, confirm order, guest checkout
- Risk: high
- Pages: /onepagecheckout, /login/checkoutasguest
- APIs: none
- Rules: BR-CHECKOUT
Automated tests may go through billing and shipping steps but must NOT click "Confirm" on the final step.

## Module: Wishlist and Compare
- Keywords: wishlist, wish list, compare, comparison
- Risk: low
- Pages: /wishlist, /compareproducts
- APIs: POST /addproducttocart/details/{productId}/2
- Rules: none
