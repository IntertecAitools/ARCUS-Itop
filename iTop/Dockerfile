FROM php:8.2-apache

RUN apt-get update && apt-get install -y \
    libpng-dev \
    libldap2-dev \
    libicu-dev \
    libzip-dev \
    && docker-php-ext-install gd ldap intl zip mysqli pdo pdo_mysql \
    && a2enmod rewrite

WORKDIR /var/www/html

COPY . .

RUN chown -R www-data:www-data /var/www/html \
    && chmod -R 755 /var/www/html