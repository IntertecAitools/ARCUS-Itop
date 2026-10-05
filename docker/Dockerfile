FROM php:8.3-apache

# Build deps for the PHP extensions iTop requires, plus graphviz (impact
# analysis graphs) and the mysql client (iTop's backup feature shells out
# to mysqldump and refuses to install without it).
RUN apt-get update && apt-get install -y --no-install-recommends \
        libzip-dev \
        libpng-dev \
        libjpeg62-turbo-dev \
        libfreetype6-dev \
        libxml2-dev \
        libldap2-dev \
        libcurl4-openssl-dev \
        unzip \
        graphviz \
        mariadb-client \
    && rm -rf /var/lib/apt/lists/*

# MariaDB client 11.x verifies the server certificate by default, but MySQL 8
# presents a self-signed one - that breaks iTop's mysqldump-based backups.
RUN echo '[client]' > /etc/mysql/conf.d/99-itop.cnf \
    && echo 'ssl-verify-server-cert=0' >> /etc/mysql/conf.d/99-itop.cnf

# Mandatory extensions per setup/setuputils.class.inc.php::GetPHPMandatoryExtensions()
# (iconv, simplexml, hash, json, session, pcre, dom, zlib, fileinfo, mbstring, curl
#  are already bundled in the official image)
RUN docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-configure ldap --with-libdir=lib/$(dpkg-architecture -q DEB_HOST_MULTIARCH)/ \
    && docker-php-ext-install -j"$(nproc)" \
        mysqli \
        soap \
        zip \
        gd \
        ldap \
        opcache

# Optional but recommended by the installer: apcu (performance)
RUN pecl install apcu \
    && docker-php-ext-enable apcu

# iTop needs mod_rewrite (portal / Symfony routes) and .htaccess overrides
RUN a2enmod rewrite headers

# Session dir referenced by session.save_path in php.ini
RUN mkdir -p /var/lib/php/sessions \
    && chown www-data:www-data /var/lib/php/sessions \
    && chmod 1733 /var/lib/php/sessions

COPY php.ini /usr/local/etc/php/conf.d/zz-itop.ini
COPY itop-apache.conf /etc/apache2/conf-available/itop.conf
RUN a2enconf itop

WORKDIR /var/www/html
