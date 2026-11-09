# API Contracts

Demo Web Shop is a server-rendered nopCommerce store. It has no public REST API,
but the storefront uses a few HTTP endpoints that can be tested with Playwright's
`APIRequestContext`. The API Agent reads the JSON block below; keep it valid JSON.

Notes:
- Cart endpoints are tied to the anonymous session cookie, so every API test should
  use its own request context.
- `safe: false` endpoints change server state. They are tested only inside an
  anonymous session and never against account or checkout data.

```json
[
  {
    "id": "home",
    "method": "GET",
    "path": "/",
    "description": "Storefront home page",
    "responseType": "html",
    "safe": true,
    "examples": [
      { "name": "home page is reachable", "expectedStatus": 200, "expectBodyContains": ["Demo Web Shop"] }
    ]
  },
  {
    "id": "search",
    "method": "GET",
    "path": "/search",
    "description": "Product search results page",
    "responseType": "html",
    "safe": true,
    "examples": [
      { "name": "known product is found", "query": { "q": "laptop" }, "expectedStatus": 200, "expectBodyContains": ["14.1-inch Laptop"] },
      { "name": "term shorter than 3 characters is rejected", "query": { "q": "ab" }, "expectedStatus": 200, "expectBodyContains": ["Search term minimum length is 3 characters"] },
      { "name": "unknown term returns no products", "query": { "q": "zzqqxx" }, "expectedStatus": 200, "expectBodyContains": ["No products were found that matched your criteria."] }
    ]
  },
  {
    "id": "add-to-cart-catalog",
    "method": "POST",
    "path": "/addproducttocart/catalog/{productId}/1/{quantity}",
    "description": "Adds a simple product to the session cart from a product listing. Returns JSON.",
    "responseType": "json",
    "safe": false,
    "examples": [
      { "name": "valid product is added", "pathParams": { "productId": "31", "quantity": "1" }, "expectedStatus": 200, "expectJson": { "success": true, "updatetopcartsectionhtml": "(1)" } },
      { "name": "unknown product id is rejected", "pathParams": { "productId": "999999", "quantity": "1" }, "expectedStatus": 200, "expectJson": { "success": false, "message": "No product found with the specified ID" } }
    ]
  }
]
```
