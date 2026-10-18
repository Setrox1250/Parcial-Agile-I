
-- 0.5.3: Seed de sucursales provisionales
-- LISTA PROVISIONAL pendiente de ratificación por el Product Owner (decisión B-06).
-- Sedes: Chimbote, Chiclayo, Trujillo, Tumbes, Piura.

INSERT INTO public.sucursales (codigo, nombre, estado)
VALUES
    ('CBO', 'Chimbote', 'ACTIVA'),
    ('CHI', 'Chiclayo', 'ACTIVA'),
    ('TRU', 'Trujillo', 'ACTIVA'),
    ('TUM', 'Tumbes', 'ACTIVA'),
    ('PIU', 'Piura', 'ACTIVA')
ON CONFLICT (codigo) DO NOTHING;
