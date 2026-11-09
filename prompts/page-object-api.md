# Page Object API (src/pages)

All pages extend BasePage, so every page object also has the header members.

## BasePage (all pages)
- `searchInput`, `searchButton`, `cartQuantity`, `loginLink`, `logoutLink`, `notification`, `topMenu` (Locators)
- `open(path)`: navigate relative to the base URL
- `search(term)`: type into the header search and click Search
- `cartCount(): Promise<number>`
- `expectCartCount(n)`: header shows "(n)"
- `expectNotification(text)`: green notification bar contains text

## homePage: HomePage
- `goto()`: open "/" and assert title "Demo Web Shop"
- `openCategory(name)`: click a top-menu category, e.g. "Books"
- `featuredProducts` (Locator)

## searchPage: SearchResultsPage
- `goto(term)`: open /search?q=term directly
- `productItems`, `productTitles`, `results` (Locators)
- `product(name)`: Locator of one product tile
- `addToCart(name)`: click "Add to cart" on that tile
- `expectProductListed(name)`
- `expectMessage(text)`: results area contains text (min-length or no-results messages)

## loginPage: LoginPage
- `goto()`, `login(email, password)`
- `email`, `password`, `submit`, `errorSummary` (Locators)
- `expectError(text)`: validation summary contains text

## productPage: ProductPage
- `goto(slug)` e.g. "141-inch-laptop"; `addToCart(quantity)`
- `title`, `price`, `quantity`, `addToCartButton` (Locators)

## cartPage: CartPage
- `goto()`, `row(productName)`, `expectProduct(productName, quantity)`
- `lineValues(productName): Promise<[unitPrice, quantity, lineTotal]>`
- `rows`, `termsCheckbox`, `checkoutButton` (Locators)

## data (test-data/demowebshop.json)
- `data.search.validTerm` "laptop", `data.search.expectedProduct` "14.1-inch Laptop"
- `data.search.shortTerm`, `data.search.noResultTerm`
- `data.products.laptop.{id,name,slug,price}`
- `data.login.unknownEmail`, `data.login.anyPassword`, `data.login.invalidEmailFormat`
- `data.messages.addedToCart | searchTooShort | searchNoResults | loginFailed`
