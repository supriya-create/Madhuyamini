-- Full-text search over products. The expression must match `searchDocument`
-- in src/features/catalog/data.ts exactly, or the planner cannot use the index.
CREATE INDEX "products_search_idx" ON "products" USING GIN ((
  setweight(to_tsvector('english', "title"), 'A') ||
  setweight(to_tsvector('english', coalesce("subtitle", '')), 'B') ||
  setweight(to_tsvector('english', "description"), 'C')
));
