-- Le missioni si leggono anche senza account: is_admin() per un visitatore anonimo risponde sempre false.
grant execute on function public.is_admin() to anon;
